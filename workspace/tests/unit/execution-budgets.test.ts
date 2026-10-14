/**
 * Bounded agent runtime — PR-09, SRS-AGENT-004..008.
 *
 * A scripted, deliberately misbehaving "model" is used to prove the runtime's
 * guarantees rather than to demonstrate a happy path: budgets are enforced in
 * runtime code, failed tool calls still consume budget, the deadline stops new tool
 * calls, and an attempt that produces no report cannot be mistaken for success.
 */
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { AgentRuntime } from '../../src/app/agent/runtime.js';
import { emptyAttemptCache, type ToolContext } from '../../src/app/agent/types.js';
import { ToolRegistry, defineTool } from '../../src/app/tools/registry.js';
import type { AnomalyAnalysis } from '../../src/domain/anomaly.js';
import type { LlmMessage, LlmProviderPort, LlmToolCall, LlmTurnRequest, LlmTurnResult, RunRecord, Store } from '../../src/app/ports.js';

// ---------------------------------------------------------------------------
// Test doubles
// ---------------------------------------------------------------------------

interface ScriptStep {
  toolCalls?: LlmToolCall[];
  text?: string;
  usage?: { promptTokens: number; completionTokens: number };
  delayMs?: number;
}

class ScriptedProvider implements LlmProviderPort {
  readonly name = 'scripted';
  readonly model = 'scripted-1';
  #turn = 0;
  readonly #script: ScriptStep[];

  constructor(script: ScriptStep[]) {
    this.#script = script;
  }

  async runTurn(request: LlmTurnRequest): Promise<LlmTurnResult> {
    const step = this.#script[Math.min(this.#turn, this.#script.length - 1)] ?? {};
    this.#turn += 1;
    if (step.delayMs) {
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, step.delayMs);
        request.signal.addEventListener(
          'abort',
          () => {
            clearTimeout(timer);
            resolve();
          },
          { once: true },
        );
      });
    }
    const toolCalls = step.toolCalls ?? [];
    const text = step.text ?? null;
    const assistantMessage: LlmMessage = { role: 'assistant', content: text ?? '', toolCalls };
    return {
      assistantMessage,
      toolCalls,
      text,
      usage: step.usage ?? { promptTokens: 10, completionTokens: 10 },
      model: this.model,
    };
  }
}

function fakeStore() {
  const steps: Array<Record<string, unknown>> = [];
  const store = {
    runs: {
      touch: async () => undefined,
      recordUsage: async () => undefined,
    },
    steps: {
      append: async (input: Record<string, unknown>) => {
        const record = { ...input, id: `step-${steps.length + 1}`, sequence: steps.length + 1, createdAt: new Date(), completedAt: null };
        steps.push(record);
        return record;
      },
    },
  } as unknown as Store;
  return { store, steps };
}

const ANALYSIS: AnomalyAnalysis = {
  ruleVersion: 'v1',
  window: { from: '2026-07-01', to: '2026-09-30' },
  transactionCount: 0,
  totalSpendMinor: 0,
  currency: 'USD',
  baselineMedianMinor: 0,
  findings: [],
};

function buildRegistry(options: { throwOnTool?: boolean } = {}): ToolRegistry<ToolContext> {
  const registry = new ToolRegistry<ToolContext>();
  registry.register(
    defineTool({
      name: 'noop',
      description: 'Does nothing, counts as one tool call.',
      effect: 'READ',
      argsSchema: z.object({}),
      resultSchema: z.object({ ok: z.boolean() }),
      execute: async () => {
        if (options.throwOnTool) throw new Error('tool failed deliberately with internal detail');
        return { ok: true };
      },
    }),
  );
  registry.register(
    defineTool({
      name: 'detect_spend_anomalies',
      description: 'Test stand-in for the deterministic rules.',
      effect: 'READ',
      argsSchema: z.object({}),
      resultSchema: z.object({ ruleVersion: z.string() }),
      execute: async (_args, context: ToolContext) => {
        context.cache.analysis = ANALYSIS;
        return { ruleVersion: ANALYSIS.ruleVersion };
      },
    }),
  );
  registry.register(
    defineTool({
      name: 'finalize_research_report',
      description: 'Test stand-in for the report finalisation tool.',
      effect: 'READ',
      argsSchema: z.object({ summary: z.string() }),
      resultSchema: z.object({ accepted: z.boolean() }),
      execute: async (args, context: ToolContext) => {
        context.cache.report = { summary: args.summary, highlightedFindingIds: [], limitations: [] };
        return { accepted: true };
      },
    }),
  );
  return registry;
}

const RUN = {
  id: 'run-1',
  tenantId: 'tenant-demo',
  ownerId: 'user-1',
  taskType: 'SPEND_ANOMALY_RESEARCH',
  status: 'RUNNING',
  request: { task: 'Analyse spend', taskType: 'SPEND_ANOMALY_RESEARCH', from: '2026-07-01', to: '2026-09-30', currency: 'USD' },
  policyVersion: 'v1',
  version: 1,
  attemptId: 'attempt-1',
  attemptCount: 1,
  heartbeatAt: null,
  tokenUsage: null,
  result: null,
  errorCode: null,
  errorMessage: null,
  idempotencyKeyId: null,
  createdAt: new Date(),
  startedAt: new Date(),
  completedAt: null,
  updatedAt: new Date(),
} as unknown as RunRecord;

function buildRuntime(options: {
  script: ScriptStep[];
  budgets?: Partial<{ maxToolCalls: number; deadlineMs: number; maxModelRetries: number; tokenBudget: number }>;
  throwOnTool?: boolean;
}) {
  const { store, steps } = fakeStore();
  const runtime = new AgentRuntime({
    store,
    llm: new ScriptedProvider(options.script),
    registry: buildRegistry({ ...(options.throwOnTool ? { throwOnTool: true } : {}) }),
    logger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
    budgets: { maxToolCalls: 6, deadlineMs: 5_000, maxModelRetries: 0, tokenBudget: 24_000, ...options.budgets },
    now: () => new Date(),
    createProposal: async () => {
      throw new Error('not used in this test');
    },
  });
  return { runtime, steps };
}

const toolCall = (name: string, id = `call-${Math.random()}`, args: Record<string, unknown> = {}): LlmToolCall => ({
  id,
  name,
  arguments: args,
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('runtime: tool call budget', () => {
  it('stops the attempt when the tool budget is exhausted', async () => {
    const { runtime, steps } = buildRuntime({
      script: Array.from({ length: 10 }, (_, index) => ({ toolCalls: [toolCall('noop', `call-${index}`)] })),
      budgets: { maxToolCalls: 3 },
    });

    const outcome = await runtime.execute({ run: RUN, attemptId: 'attempt-1' });
    expect(outcome.kind).toBe('FAILED');
    if (outcome.kind === 'FAILED') {
      expect(outcome.code).toBe('TOOL_CALL_BUDGET_EXCEEDED');
      expect(outcome.retryable).toBe(false);
    }
    const toolSteps = steps.filter((step) => step.stepType === 'TOOL_CALL');
    expect(toolSteps).toHaveLength(3);
  });

  it('counts failed tool invocations toward the budget (SRS-AGENT-004)', async () => {
    const { runtime, steps } = buildRuntime({
      script: Array.from({ length: 10 }, (_, index) => ({ toolCalls: [toolCall('noop', `call-${index}`)] })),
      budgets: { maxToolCalls: 2 },
      throwOnTool: true,
    });

    const outcome = await runtime.execute({ run: RUN, attemptId: 'attempt-1' });
    expect(outcome.kind).toBe('FAILED');
    const toolSteps = steps.filter((step) => step.stepType === 'TOOL_CALL');
    expect(toolSteps).toHaveLength(2);
    expect(toolSteps.every((step) => step.status === 'FAILED')).toBe(true);
  });
});

describe('runtime: execution deadline', () => {
  it('refuses further tool calls once the deadline has elapsed and reports a retryable timeout', async () => {
    const { runtime, steps } = buildRuntime({
      script: [
        // Permitted before the deadline: executes normally.
        { toolCalls: [toolCall('noop', 'call-1')] },
        // The provider takes longer than the remaining budget, so the tool call the
        // model then asks for must be refused.
        { toolCalls: [toolCall('noop', 'call-2')], delayMs: 80 },
      ],
      budgets: { deadlineMs: 40 },
    });

    const outcome = await runtime.execute({ run: RUN, attemptId: 'attempt-1' });
    expect(outcome.kind).toBe('FAILED');
    if (outcome.kind === 'FAILED') {
      expect(outcome.code).toBe('EXECUTION_DEADLINE_EXCEEDED');
      expect(outcome.retryable).toBe(true);
    }
    // The pre-deadline tool call stands; the post-deadline one never ran.
    expect(steps.filter((step) => step.stepType === 'TOOL_CALL')).toHaveLength(1);
    expect(steps.find((step) => step.stepType === 'TOOL_CALL')?.payload).toMatchObject({ tool: 'noop' });
    expect(steps.some((step) => step.stepType === 'ATTEMPT_FAILED' && step.errorCode === 'EXECUTION_DEADLINE_EXCEEDED')).toBe(true);
  });
});

describe('runtime: token budget', () => {
  it('fails the attempt when the token budget is exceeded', async () => {
    const { runtime } = buildRuntime({
      script: [{ toolCalls: [toolCall('noop')], usage: { promptTokens: 900, completionTokens: 900 } }],
      budgets: { tokenBudget: 1_000 },
    });
    const outcome = await runtime.execute({ run: RUN, attemptId: 'attempt-1' });
    expect(outcome.kind).toBe('FAILED');
    if (outcome.kind === 'FAILED') {
      expect(outcome.code).toBe('TOKEN_BUDGET_EXCEEDED');
      expect(outcome.retryable).toBe(false);
    }
  });
});

describe('runtime: report contract', () => {
  it('refuses to treat a text-only response as a result', async () => {
    const { runtime, steps } = buildRuntime({ script: [{ text: 'I am done analysing, trust me.' }] });
    const outcome = await runtime.execute({ run: RUN, attemptId: 'attempt-1' });
    expect(outcome.kind).toBe('FAILED');
    if (outcome.kind === 'FAILED') expect(outcome.code).toBe('MODEL_OUTPUT_INVALID');
    expect(steps.some((step) => step.stepType === 'ATTEMPT_FAILED')).toBe(true);
  });

  it('completes only after a finalised report backed by a deterministic analysis', async () => {
    const { runtime } = buildRuntime({
      script: [
        { toolCalls: [toolCall('detect_spend_anomalies', 'call-1')] },
        {
          toolCalls: [toolCall('finalize_research_report', 'call-2', { summary: 'Two findings were identified for review.' })],
          usage: { promptTokens: 20, completionTokens: 20 },
        },
        { text: 'All done.' },
      ],
    });
    const outcome = await runtime.execute({ run: RUN, attemptId: 'attempt-1' });
    expect(outcome.kind).toBe('COMPLETED');
    if (outcome.kind === 'COMPLETED') {
      expect(outcome.analysis.ruleVersion).toBe('v1');
      expect(outcome.model).toBe('scripted-1');
      expect(outcome.tokenUsage.modelTurns).toBeGreaterThan(0);
    }
  });
});

describe('runtime: unregistered capabilities', () => {
  it('reports an unregistered tool call as a failed tool step and keeps the attempt alive', async () => {
    const { runtime, steps } = buildRuntime({
      script: [
        { toolCalls: [toolCall('execute_sql', 'call-1')] },
        { toolCalls: [toolCall('detect_spend_anomalies', 'call-2')] },
        { toolCalls: [toolCall('finalize_research_report', 'call-3', { summary: 'Analysis complete after the rejected tool call.' })] },
        { text: 'done' },
      ],
    });

    const outcome = await runtime.execute({ run: RUN, attemptId: 'attempt-1' });
    expect(outcome.kind).toBe('COMPLETED');
    const rejected = steps.find((step) => step.stepType === 'TOOL_CALL' && step.status === 'FAILED');
    expect(rejected).toBeDefined();
    expect(rejected?.errorCode).toBe('TOOL_NOT_REGISTERED');
  });
});

describe('runtime: observability', () => {
  it('records every model turn and tool call with latency and attempt identity', async () => {
    const { runtime, steps } = buildRuntime({
      script: [
        { toolCalls: [toolCall('detect_spend_anomalies', 'call-1')] },
        { toolCalls: [toolCall('finalize_research_report', 'call-2', { summary: 'Report finalised for the latency assertion.' })] },
        { text: 'done' },
      ],
    });

    await runtime.execute({ run: RUN, attemptId: 'attempt-xyz' });

    expect(steps.filter((step) => step.stepType === 'MODEL_TURN')).toHaveLength(3);
    const toolSteps = steps.filter((step) => step.stepType === 'TOOL_CALL');
    expect(toolSteps).toHaveLength(2);
    for (const step of toolSteps) {
      expect(step.attemptId).toBe('attempt-xyz');
      expect(typeof step.latencyMs).toBe('number');
    }
    expect(steps[0]?.stepType).toBe('ATTEMPT_STARTED');
  });

  it('starts each attempt from an empty cache', () => {
    const cache = emptyAttemptCache();
    expect(cache.analysis).toBeNull();
    expect(cache.report).toBeNull();
    expect(cache.proposals).toHaveLength(0);
  });
});
