/**
 * Deterministic scripted provider.
 *
 * This is the default provider so the whole system — including its failure
 * paths — is reproducible without an API key and without network access. It is a
 * fixture, not a model: it follows a fixed plan derived from the conversation so
 * far, which is exactly what makes tests deterministic.
 *
 * It also provides bounded failure injection (provider errors, timeouts,
 * malformed tool arguments, attempts to call an unregistered tool). Those knobs
 * exist so the runtime's guarantees — schema validation, tool allow-listing,
 * budget enforcement, retry classification — are tested against a misbehaving
 * "model" rather than assumed.
 */
import { AppError, ErrorCode } from '../../domain/errors.js';
import type { LlmMessage, LlmProviderPort, LlmTurnRequest, LlmTurnResult, LlmToolCall } from '../../app/ports.js';

export interface MockProviderFaults {
  /** Turn indices (0-based) where the provider reports a retryable error. */
  providerErrorTurns?: number[];
  /** Turn indices where the provider call hangs past the deadline. */
  timeoutTurns?: number[];
  /** Turn indices where a tool call carries invalid arguments. */
  malformedArgsTurns?: number[];
  /** Turn indices where the "model" tries to call something unregistered. */
  unregisteredToolTurns?: number[];
  /** Turn indices where no final report is produced (contract violation). */
  omitFinalReportTurns?: number[];
}

export interface MockProviderOptions {
  model?: string;
  faults?: MockProviderFaults;
  /** Artificial latency per turn, in milliseconds. */
  latencyMs?: number;
}

interface ToolCallRecord {
  name: string;
  content: unknown;
  failed: boolean;
}

export class MockLlmProvider implements LlmProviderPort {
  readonly name = 'mock';
  readonly model: string;
  readonly #faults: MockProviderFaults;
  readonly #latencyMs: number;

  constructor(options: MockProviderOptions = {}) {
    this.model = options.model ?? 'mock-financial-researcher-v1';
    this.#faults = options.faults ?? {};
    this.#latencyMs = options.latencyMs ?? 0;
  }

  async runTurn(request: LlmTurnRequest): Promise<LlmTurnResult> {
    await this.#maybeDelay(request.signal);

    const history = collectHistory(request.messages);
    const turn = history.assistantTurns;
    const usage = estimateUsage(request.messages);

    if (this.#faults.timeoutTurns?.includes(turn)) {
      throw new AppError({
        code: ErrorCode.PROVIDER_TIMEOUT,
        message: 'Simulated provider timeout.',
        category: 'TIMEOUT',
        httpStatus: 504,
        retryable: true,
      });
    }
    if (this.#faults.providerErrorTurns?.includes(turn)) {
      throw new AppError({
        code: ErrorCode.PROVIDER_ERROR,
        message: 'Simulated provider error.',
        category: 'PROVIDER',
        httpStatus: 503,
        retryable: true,
      });
    }
    if (this.#faults.unregisteredToolTurns?.includes(turn)) {
      return {
        assistantMessage: { role: 'assistant', content: 'Attempting an unregistered capability.', toolCalls: [] },
        toolCalls: [call('execute_sql', { sql: 'DROP TABLE ledger_entries' })],
        text: null,
        usage,
        model: this.model,
      };
    }
    if (this.#faults.malformedArgsTurns?.includes(turn)) {
      return {
        assistantMessage: { role: 'assistant', content: 'Calling a tool with malformed arguments.', toolCalls: [] },
        toolCalls: [call('detect_spend_anomalies', { from: 42, to: null })],
        text: null,
        usage,
        model: this.model,
      };
    }

    const window = extractWindow(request.messages);
    const calls = history.toolCalls;
    /** Only a *successful* call advances the plan: a rejected call is retried, as a real model would. */
    const succeeded = (name: string): boolean => lastSuccessData(calls, name) !== null;

    // The report is already finalised: end the attempt with a text-only turn, which
    // is how a real model signals it is finished. Without this the script would keep
    // re-finalising until the tool budget ran out.
    if (succeeded('finalize_research_report')) {
      return {
        assistantMessage: { role: 'assistant', content: 'The research report is finalised.' },
        toolCalls: [],
        text: 'The research report is finalised.',
        usage,
        model: this.model,
      };
    }

    // 1. Retrieve the window's transactions.
    if (!succeeded('list_transactions')) {
      return this.#toolTurn('Retrieving transactions for the analysis window.', call('list_transactions', { from: window.from, to: window.to }), usage);
    }

    // 2. Run the deterministic anomaly rules.
    if (!succeeded('detect_spend_anomalies')) {
      return this.#toolTurn('Running the versioned anomaly rules.', call('detect_spend_anomalies', { from: window.from, to: window.to }), usage);
    }

    // 3. Propose a refund when, and only when, a rule supports one.
    //
    // Two behaviours here mirror what a competent analyst would do:
    //  * the refund is claimed against a specific transaction and never exceeds that
    //    transaction's own amount, so the amount is defensible on the evidence;
    //  * when the policy denies a proposal, the next eligible finding is tried
    //    instead of giving up (a conflicting refund for one transaction does not
    //    invalidate an anomaly on another).
    const analysis = lastSuccessData(calls, 'detect_spend_anomalies') as DetectResult | null;
    const listed = lastSuccessData(calls, 'list_transactions') as ListedTransactions | null;
    const amountByTransaction = new Map((listed?.transactions ?? []).map((tx) => [tx.transactionId, tx.amountMinor]));

    const eligible = (analysis?.findings ?? []).filter((candidate) => candidate.refundEligible && candidate.suggestedRefundMinor > 0);
    const attempted = calls.filter((record) => record.name === 'create_refund_proposal' && !record.failed).length;
    const lastProposal = lastAnyData(calls, 'create_refund_proposal') as ProposalResult | null;
    // A denied proposal means "try the next finding"; an accepted one means move on.
    const mayPropose = lastProposal === null || lastProposal.policyOutcome === 'DENY';
    const finding = eligible[attempted] ?? null;
    // Leave room in the six-call budget for the final report.
    const budgetRemains = calls.length < 5;

    if (finding && mayPropose && budgetRemains) {
      const supplierId = finding.supplierIds[0] ?? '';
      const transactionId = finding.transactionIds.find((id) => amountByTransaction.has(id)) ?? finding.transactionIds[0] ?? '';
      const transactionAmount = amountByTransaction.get(transactionId) ?? finding.suggestedRefundMinor;
      const amountMinor = Math.max(1, Math.min(finding.suggestedRefundMinor, transactionAmount));
      return this.#toolTurn(
        `Proposing a refund bounded by finding ${finding.findingId} (${amountMinor} of ${finding.suggestedRefundMinor} minor units identified).`,
        call('create_refund_proposal', {
          transactionId,
          amountMinor,
          currency: analysis?.currency ?? 'USD',
          justification: `${finding.title}: ${finding.observations.join(' ')} (supplier ${supplierId}, rule ${finding.ruleId}).`,
          findingId: finding.findingId,
        }),
        usage,
      );
    }

    if (this.#faults.omitFinalReportTurns?.includes(turn)) {
      return {
        assistantMessage: { role: 'assistant', content: 'I have finished analysing but will not finalise a report.' },
        toolCalls: [],
        text: 'I have finished analysing but will not finalise a report.',
        usage,
        model: this.model,
      };
    }

    // 4. Finalise with an interpretation that is explicitly separated from facts.
    const proposalResult = lastAnyData(calls, 'create_refund_proposal') as ProposalResult | null;
    const limitations = [
      'Analysis is limited to the synthetic dataset supplied with this deployment.',
      'Findings come from the versioned deterministic rules and are not a determination of fraud.',
    ];
    if (proposalResult && proposalResult.policyOutcome === 'DENY') {
      limitations.push('A proposed refund was denied by policy and was therefore not settled.');
    }
    if (proposalResult?.requiresApproval) {
      limitations.push('A proposed refund exceeds the approval threshold and awaits a human decision.');
    }

    const summary = buildSummary(analysis, proposalResult);
    return this.#toolTurn(
      'Finalising the research report.',
      call('finalize_research_report', {
        summary,
        highlightedFindingIds: (analysis?.findings ?? []).slice(0, 5).map((item) => item.findingId),
        limitations,
      }),
      usage,
    );
  }

  #toolTurn(text: string, toolCall: LlmToolCall, usage: { promptTokens: number; completionTokens: number }): LlmTurnResult {
    return {
      assistantMessage: { role: 'assistant', content: text, toolCalls: [toolCall] },
      toolCalls: [toolCall],
      text,
      usage,
      model: this.model,
    };
  }

  async #maybeDelay(signal: AbortSignal): Promise<void> {
    if (this.#latencyMs <= 0) return;
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(resolve, this.#latencyMs);
      const onAbort = (): void => {
        clearTimeout(timer);
        reject(
          new AppError({
            code: ErrorCode.PROVIDER_TIMEOUT,
            message: 'Provider call aborted by the execution deadline.',
            category: 'TIMEOUT',
            httpStatus: 504,
            retryable: true,
          }),
        );
      };
      if (signal.aborted) onAbort();
      else signal.addEventListener('abort', onAbort, { once: true });
    });
  }
}

interface DetectResult {
  currency: string;
  findings: Array<{
    findingId: string;
    ruleId: string;
    title: string;
    observations: string[];
    transactionIds: string[];
    supplierIds: string[];
    refundEligible: boolean;
    suggestedRefundMinor: number;
  }>;
}

interface ListedTransactions {
  transactions: Array<{ transactionId: string; amountMinor: number }>;
}

interface ProposalResult {
  proposalId: string | null;
  status: string;
  policyOutcome: 'ALLOW' | 'REQUIRES_APPROVAL' | 'DENY';
  requiresApproval: boolean;
  denyReasons: string[];
  amountMinor: number;
  currency: string;
}

interface History {
  assistantTurns: number;
  toolCalls: ToolCallRecord[];
}

function collectHistory(messages: readonly LlmMessage[]): History {
  const toolCalls: ToolCallRecord[] = [];
  let assistantTurns = 0;
  for (const message of messages) {
    if (message.role === 'assistant') assistantTurns += 1;
    if (message.role === 'tool' && message.toolName) {
      let parsed: unknown = null;
      try {
        parsed = JSON.parse(message.content);
      } catch {
        parsed = null;
      }
      const failed = isFailure(parsed);
      toolCalls.push({ name: message.toolName, content: failed ? null : unwrap(parsed), failed });
    }
  }
  return { assistantTurns, toolCalls };
}

function isFailure(value: unknown): boolean {
  return typeof value === 'object' && value !== null && (value as { ok?: boolean }).ok === false;
}

function unwrap(value: unknown): unknown {
  if (typeof value === 'object' && value !== null && 'data' in value) return (value as { data: unknown }).data;
  return value;
}

function lastSuccessData(calls: readonly ToolCallRecord[], name: string): unknown {
  for (const record of [...calls].reverse()) {
    if (record.name === name && !record.failed) return record.content;
  }
  return null;
}

function lastAnyData(calls: readonly ToolCallRecord[], name: string): unknown {
  for (const record of [...calls].reverse()) {
    if (record.name === name) return record.content;
  }
  return null;
}

function call(name: string, args: unknown): LlmToolCall {
  return { id: `mock-${name}-${Math.abs(hash(JSON.stringify(args)))}`, name, arguments: args };
}

function hash(value: string): number {
  let accumulator = 0;
  for (let i = 0; i < value.length; i += 1) {
    accumulator = (accumulator << 5) - accumulator + value.charCodeAt(i);
    accumulator |= 0;
  }
  return accumulator;
}

function extractWindow(messages: readonly LlmMessage[]): { from: string; to: string } {
  for (const message of messages) {
    if (message.role !== 'user') continue;
    const match = /Analysis window:\s*(\S+)\s+to\s+(\S+)/.exec(message.content);
    if (match) return { from: match[1] as string, to: match[2] as string };
  }
  throw new AppError({
    code: ErrorCode.MODEL_OUTPUT_INVALID,
    message: 'The mock provider could not determine the analysis window from the prompt.',
    category: 'INTERNAL',
    httpStatus: 500,
    retryable: false,
  });
}

function estimateUsage(messages: readonly LlmMessage[]): { promptTokens: number; completionTokens: number } {
  const characters = messages.reduce((sum, message) => sum + message.content.length, 0);
  return { promptTokens: Math.max(1, Math.round(characters / 4)), completionTokens: 64 };
}

function buildSummary(analysis: DetectResult | null, proposal: ProposalResult | null): string {
  const findings = analysis?.findings ?? [];
  if (findings.length === 0) {
    return 'No anomalies matched the configured deterministic rules for this window. Spend is within the historical baseline for the categories analysed, and no refund is recommended on the available evidence.';
  }
  const lines = findings
    .slice(0, 6)
    .map((finding) => `- ${finding.title} (${finding.ruleId}): ${finding.observations[0] ?? ''}`);
  const proposalLine = proposal
    ? proposal.policyOutcome === 'DENY'
      ? `A refund proposal was rejected by the deterministic policy engine (${proposal.denyReasons.join(', ')}).`
      : proposal.requiresApproval
        ? `A refund proposal for ${proposal.amountMinor} minor units was recorded and requires human approval before any settlement.`
        : `A refund proposal for ${proposal.amountMinor} minor units was recorded and auto-allowed by policy.`
    : 'No refund was proposed because no finding provided a defensible overcharge basis.';
  return [
    `Deterministic rules identified ${findings.length} items of interest in the analysed window.`,
    ...lines,
    proposalLine,
    'These interpretations are based only on the records retrieved; no anomaly is asserted to be fraud.',
  ].join('\n');
}
