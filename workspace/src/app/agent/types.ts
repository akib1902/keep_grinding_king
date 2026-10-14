/**
 * Shared types for the bounded agent runtime.
 */
import type { AnomalyAnalysis } from '../../domain/anomaly.js';
import type { PolicyOutcome } from '../../domain/policy.js';
import type { Clock, LoggerPort, RunRecord, Store, TokenUsage } from '../ports.js';

/** Result of an agent-requested refund proposal (returned to the model). */
export interface ProposalCreationOutcome {
  /** Null when policy denied the proposal before anything was persisted. */
  proposalId: string | null;
  supplierId: string;
  status: string;
  policyOutcome: PolicyOutcome;
  policyVersion: string;
  requiresApproval: boolean;
  denyReasons: string[];
  amountMinor: number;
  currency: string;
  approvalId: string | null;
}

/** Model-authored part of the final report. Facts are never taken from here. */
export interface ReportDraft {
  summary: string;
  highlightedFindingIds: string[];
  limitations: string[];
}

/**
 * Per-attempt scratch state. The deterministic analysis is cached so the report
 * is built from exactly the rule output the model was shown — a re-run of the
 * rules cannot silently diverge from what the report claims.
 */
export interface AttemptCache {
  analysis: AnomalyAnalysis | null;
  report: ReportDraft | null;
  proposals: ProposalCreationOutcome[];
  /** Transactions actually retrieved, keyed by id, for evidence resolution. */
  transactions: Map<string, { id: string; supplierId: string; supplierName: string; amountMinor: number; currency: string }>;
}

export interface ToolContext {
  run: RunRecord;
  attemptId: string;
  store: Store;
  clock: Clock;
  logger: LoggerPort;
  cache: AttemptCache;
  /** Restricted application capability — the only write path the agent has. */
  createProposal(input: {
    run: RunRecord;
    attemptId: string;
    transactionId: string;
    supplierId: string;
    amountMinor: number;
    currency: string;
    justification: string;
    evidence: Record<string, unknown>;
    findingId: string;
    findingRefundEligible: boolean;
    findingSuggestedRefundMinor: number;
  }): Promise<ProposalCreationOutcome>;
}

export type ExecutionOutcome =
  | {
      kind: 'COMPLETED';
      report: ReportDraft;
      analysis: AnomalyAnalysis;
      proposals: ProposalCreationOutcome[];
      tokenUsage: TokenUsage;
      model: string;
    }
  | {
      kind: 'AWAITING_APPROVAL';
      report: ReportDraft;
      analysis: AnomalyAnalysis;
      proposals: ProposalCreationOutcome[];
      tokenUsage: TokenUsage;
      model: string;
      pendingProposalId: string;
      approvalId: string | null;
    }
  | {
      kind: 'FAILED';
      code: string;
      message: string;
      retryable: boolean;
      tokenUsage: TokenUsage;
      /** True when the failure occurred after a proposal already needed approval. */
      pendingProposalId?: string;
    };

export const emptyAttemptCache = (): AttemptCache => ({
  analysis: null,
  report: null,
  proposals: [],
  transactions: new Map(),
});
