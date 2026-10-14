/**
 * Composition root.
 *
 * Everything is constructed here and injected downwards: no service reaches for a
 * global, no module instantiates its own Prisma client, and the LLM provider can
 * be replaced in tests by passing an override. That is what keeps the domain and
 * application layers free of infrastructure concerns.
 */
import type { AppConfig } from './config/env.js';
import { loadConfig } from './config/env.js';
import { resolvePolicy, type PolicyConfig } from './domain/policy.js';
import { PrismaStore } from './infra/prisma/store.js';
import { BullMqQueue, createRedisClient, type QueueConfig } from './infra/queue/bullmq.js';
import { MockLlmProvider } from './infra/llm/mock-provider.js';
import { OpenAiCompatibleProvider } from './infra/llm/openai-compatible-provider.js';
import { asLoggerPort, createLogger } from './infra/logging/logger.js';
import { AgentRuntime } from './app/agent/runtime.js';
import { createFinancialToolRegistry } from './app/tools/financial-tools.js';
import type { ToolContext } from './app/agent/types.js';
import { ApprovalService } from './app/services/approval-service.js';
import { OutboxDispatcher } from './app/services/outbox-dispatcher.js';
import { ProposalService } from './app/services/proposal-service.js';
import { RecoveryService } from './app/services/recovery-service.js';
import { RunService } from './app/services/run-service.js';
import { SettlementService } from './app/services/settlement-service.js';
import { WorkflowService } from './app/services/workflow-service.js';
import type { Clock, LlmProviderPort, LoggerPort, QueuePort, Store } from './app/ports.js';
import type { ToolRegistry } from './app/tools/registry.js';

export interface CoreContainer {
  config: AppConfig;
  logger: LoggerPort;
  store: Store;
  prisma: PrismaStore;
  queue: QueuePort;
  redis: ReturnType<typeof createRedisClient>;
  policy: PolicyConfig;
  clock: Clock;
  llm: LlmProviderPort;
  registry: ToolRegistry<ToolContext>;
  close(): Promise<void>;
}

export interface RunServices {
  runs: RunService;
  proposals: ProposalService;
  approvals: ApprovalService;
  settlements: SettlementService;
  workflow: WorkflowService;
  dispatcher: OutboxDispatcher;
  recovery: RecoveryService;
  runtime: AgentRuntime;
}

export interface ContainerOverrides {
  llm?: LlmProviderPort;
  store?: Store;
  policy?: PolicyConfig;
  clock?: Clock;
}

const systemClock: Clock = { now: () => new Date() };

export function buildCore(
  config: AppConfig = loadConfig(),
  overrides: ContainerOverrides = {},
  service: 'api' | 'worker' = 'api',
): CoreContainer {
  const pinoLogger = createLogger({ level: config.logLevel, service });
  const logger = asLoggerPort(pinoLogger);
  const prisma = overrides.store ? null : PrismaStore.create();
  const store: Store = overrides.store ?? (prisma as PrismaStore);
  const queueConfig: QueueConfig = {
    name: config.redis.queueName,
    prefix: config.redis.queuePrefix,
    redisUrl: config.redis.url,
    attempts: config.redis.attempts,
    backoffMs: config.redis.backoffMs,
  };
  const queue = new BullMqQueue(queueConfig, logger);
  const redis = createRedisClient(config.redis.url);
  const llm = overrides.llm ?? createLlmProvider(config);
  const policy =
    overrides.policy ??
    resolvePolicy(config.policy.version, {
      approvalThresholdMinor: config.policy.approvalThresholdMinor,
      currency: config.policy.currency,
    });

  return {
    config,
    logger,
    store,
    prisma: prisma as PrismaStore,
    queue,
    redis,
    policy,
    clock: overrides.clock ?? systemClock,
    llm,
    registry: createFinancialToolRegistry(),
    close: async () => {
      await queue.close().catch(() => undefined);
      redis.disconnect();
      if (prisma) await prisma.disconnect();
    },
  };
}

export function buildRunServices(core: CoreContainer): RunServices {
  const { store, clock, logger, policy, config, llm, registry } = core;

  const approvalService = new ApprovalService({ store, clock, logger, policy });
  const proposalService = new ProposalService({
    store,
    clock,
    logger,
    policy,
    approvalTtlSeconds: config.approval.ttlSeconds,
  });
  const settlementService = new SettlementService({ store, clock, logger, policy });

  const runtime = new AgentRuntime({
    store,
    llm,
    registry,
    logger,
    budgets: {
      maxToolCalls: config.agent.maxToolCalls,
      deadlineMs: config.agent.deadlineMs,
      maxModelRetries: config.agent.maxModelRetries,
      tokenBudget: config.agent.tokenBudget,
    },
    now: () => clock.now(),
    createProposal: (input) => proposalService.create(input),
  });

  const workflow = new WorkflowService({
    store,
    clock,
    logger,
    runtime,
    settlement: settlementService,
    maxAttempts: config.redis.attempts,
    providerName: llm.name,
  });

  const dispatcher = new OutboxDispatcher({
    store,
    queue: core.queue,
    clock,
    logger,
    maxAttempts: 5,
    batchSize: 20,
  });

  const recovery = new RecoveryService({
    store,
    clock,
    logger,
    approvals: approvalService,
    staleAttemptMs: config.recovery.staleAttemptMs,
    maxAttempts: config.redis.attempts,
    batchSize: 25,
  });

  const runs = new RunService({ store, clock, logger, policyVersion: policy.version });

  return {
    runs,
    proposals: proposalService,
    approvals: approvalService,
    settlements: settlementService,
    workflow,
    dispatcher,
    recovery,
    runtime,
  };
}

export function createLlmProvider(config: AppConfig): LlmProviderPort {
  if (config.llm.provider === 'openai-compatible') {
    if (!config.llm.baseUrl || !config.llm.apiKey) {
      throw new Error(
        'LLM_PROVIDER=openai-compatible requires LLM_BASE_URL and LLM_API_KEY. Set them, or use LLM_PROVIDER=mock for the deterministic offline provider.',
      );
    }
    return new OpenAiCompatibleProvider({
      baseUrl: config.llm.baseUrl,
      apiKey: config.llm.apiKey,
      model: config.llm.model,
      maxRetries: config.agent.maxModelRetries,
    });
  }
  return new MockLlmProvider({ model: config.llm.model === 'unset' ? undefined : config.llm.model });
}
