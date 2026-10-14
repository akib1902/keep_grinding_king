/**
 * Application-layer ports.
 *
 * The domain and application layers depend on these interfaces, never on Prisma,
 * Redis, Fastify or a specific LLM vendor (SRS §2.2: business rules stay
 * independent of routing, persistence and the model provider). Infrastructure
 * supplies the implementations; tests supply fakes.
 *
 * Amounts are integer minor units throughout. Timestamps are `Date` objects at
 * this boundary; ISO strings only appear in JSON/HTTP payloads.
 */
import type { AnomalyAnalysis, AnomalyFinding } from '../domain/anomaly.js';
import type { PolicyDecision, PolicyReviewInput } from '../domain/policy.js';
import type { ApprovalStatus, ProposalStatus, RunStatus, SettlementStatus, StepType } from '../domain/state.js';

// ---------------------------------------------------------------------------
// Records
// ---------------------------------------------------------------------------

export interface RunRequest {
  /** Free-text goal supplied by the analyst. */
  task: string;
  taskType: string;
  /** Inclusive ISO date range of the analysis window. */
  from: string;
  to: string;
  currency: string;
  supplierIds?: string[];
  /** Optional analysis hints; the agent may not widen the caller's data scope. */
  notes?: string;
}

export interface RunRecord {
  id: string;
  tenantId: string;
  ownerId: string;
  taskType: string;
  status: RunStatus;
  request: RunRequest;
  policyVersion: string;
  version: number;
  attemptId: string | null;
  attemptCount: number;
  heartbeatAt: Date | null;
  tokenUsage: TokenUsage | null;
  result: RunResult | null;
  errorCode: string | null;
  errorMessage: string | null;
  idempotencyKeyId: string | null;
  createdAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
  updatedAt: Date;
}

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  modelTurns: number;
}

export interface ResearchReport {
  taskType: string;
  window: { from: string; to: string };
  transactionCount: number;
  totalSpendMinor: number;
  currency: string;
  ruleVersion: string;
  /** Factual findings produced by deterministic rules. */
  findings: AnomalyFinding[];
  /** Model-authored narrative, explicitly separated from the facts. */
  interpretation: {
    model: string;
    provider: string;
    summary: string;
    /** Findings the model considers most material, by finding id. */
    highlightedFindingIds: string[];
  };
  limitations: string[];
  proposalIds: string[];
  /** Terminal outcome of the approval path, if one was involved. */
  approval?: { approvalId: string; status: ApprovalStatus; proposalId: string; reason?: string };
  settlement?: { operationId: string; status: SettlementStatus; ledgerEntryId: string | null; amountMinor: number; currency: string };
}

export interface RunResult {
  report: ResearchReport;
  generatedAt: string;
}

export interface RunStepRecord {
  id: string;
  runId: string;
  sequence: number;
  attemptId: string | null;
  stepType: StepType;
  status: 'STARTED' | 'SUCCEEDED' | 'FAILED' | 'SKIPPED';
  summary: string | null;
  payload: Record<string, unknown> | null;
  errorCode: string | null;
  errorMessage: string | null;
  retryable: boolean | null;
  latencyMs: number | null;
  createdAt: Date;
  completedAt: Date | null;
}

export interface RunEventRecord {
  id: string;
  runId: string;
  sequence: number;
  eventType: string;
  version: number;
  payload: Record<string, unknown>;
  createdAt: Date;
}

export interface OutboxRecord {
  id: string;
  topic: string;
  payload: Record<string, unknown>;
  dedupeKey: string;
  status: 'PENDING' | 'DISPATCHED' | 'FAILED';
  attempts: number;
  lastError: string | null;
  availableAt: Date;
  createdAt: Date;
  dispatchedAt: Date | null;
}

export interface IdempotencyRecord {
  id: string;
  scope: string;
  key: string;
  tenantId: string;
  requestHash: string;
  status: 'IN_PROGRESS' | 'COMPLETED' | 'FAILED';
  statusCode: number | null;
  responseBody: Record<string, unknown> | null;
  resourceId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface SupplierRecord {
  id: string;
  tenantId: string;
  externalRef: string;
  name: string;
  riskTier: string | null;
  active: boolean;
}

export interface TransactionRecord {
  id: string;
  tenantId: string;
  supplierId: string;
  amountMinor: number;
  currency: string;
  occurredAt: Date;
  invoiceRef: string | null;
  description: string;
  category: string;
  status: string;
}

export interface TransactionQuery {
  tenantId: string;
  from: string;
  to: string;
  supplierIds?: string[];
  category?: string;
  minAmountMinor?: number;
  limit: number;
}

export interface RefundProposalRecord {
  id: string;
  tenantId: string;
  runId: string;
  supplierId: string;
  transactionId: string;
  amountMinor: number;
  currency: string;
  refundableAmountMinor: number;
  justification: string;
  evidence: Record<string, unknown>;
  status: ProposalStatus;
  reviewedHash: string;
  revision: number;
  policyVersion: string;
  policyDecision: PolicyDecision;
  requiresApproval: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface ApprovalRecord {
  id: string;
  tenantId: string;
  runId: string;
  proposalId: string;
  status: ApprovalStatus;
  proposalRevision: number;
  proposalHash: string;
  reviewedSnapshot: Record<string, unknown>;
  expiresAt: Date;
  decidedAt: Date | null;
  decidedById: string | null;
  decisionReason: string | null;
  createdAt: Date;
}

export interface SettlementRecord {
  id: string;
  operationId: string;
  tenantId: string;
  runId: string;
  proposalId: string;
  status: SettlementStatus;
  attempts: number;
  ledgerEntryId: string | null;
  lastError: string | null;
  createdAt: Date;
  committedAt: Date | null;
}

export interface LedgerEntryRecord {
  id: string;
  tenantId: string;
  operationId: string;
  proposalId: string;
  supplierId: string;
  entryType: 'REFUND';
  amountMinor: number;
  currency: string;
  memo: string;
  entryHash: string;
  createdAt: Date;
}

export type ActorType = 'USER' | 'AGENT' | 'SYSTEM';

export interface AuditInput {
  tenantId: string;
  runId?: string | null;
  actorType: ActorType;
  actorId?: string | null;
  action: string;
  targetType: string;
  targetId?: string | null;
  metadata?: Record<string, unknown> | null;
}

export interface AuditRecord extends AuditInput {
  id: string;
  createdAt: Date;
}

export interface UserRecord {
  id: string;
  tenantId: string;
  email: string;
  name: string;
  subject: string;
  role: 'ANALYST' | 'APPROVER' | 'ADMIN';
  active: boolean;
}

// ---------------------------------------------------------------------------
// Store ports
// ---------------------------------------------------------------------------

export interface RunStore {
  insert(input: {
    id: string;
    tenantId: string;
    ownerId: string;
    taskType: string;
    request: RunRequest;
    policyVersion: string;
    idempotencyKeyId: string | null;
  }): Promise<RunRecord>;
  findById(id: string): Promise<RunRecord | null>;
  findByIdForTenant(id: string, tenantId: string): Promise<RunRecord | null>;
  listByTenant(tenantId: string, limit: number): Promise<RunRecord[]>;

  /**
   * Compare-and-set status transition. Returns null when the expected version no
   * longer matches, which is how concurrent transitions are rejected without
   * holding a row lock across application logic (SRS-STATE-004).
   */
  transition(input: {
    id: string;
    expectedVersion: number;
    to: RunStatus;
    patch?: Partial<{
      startedAt: Date;
      completedAt: Date;
      attemptId: string | null;
      attemptCount: number;
      heartbeatAt: Date | null;
      tokenUsage: TokenUsage;
      result: RunResult;
      errorCode: string | null;
      errorMessage: string | null;
    }>;
  }): Promise<RunRecord | null>;

  /** Heartbeat for an in-flight attempt; used by stale-work reconciliation. */
  touch(id: string, attemptId: string, at: Date): Promise<void>;

  /**
   * Records rolling usage/heartbeat for an in-flight attempt WITHOUT touching the
   * optimistic-concurrency version. Keeping this out of `transition` is what stops
   * progress reporting from racing the state machine's compare-and-set.
   */
  recordUsage(id: string, attemptId: string, usage: TokenUsage, at: Date): Promise<void>;

  findStaleRunning(cutoff: Date, limit: number): Promise<RunRecord[]>;

  /** Runs currently in a given status; used by reconciliation sweeps. */
  findByStatus(status: RunStatus, limit: number): Promise<RunRecord[]>;
}

export interface StepStore {
  /** Appends with the next sequence number for the run. */
  append(input: {
    runId: string;
    attemptId: string | null;
    stepType: StepType;
    status: RunStepRecord['status'];
    summary?: string | null;
    payload?: Record<string, unknown> | null;
    errorCode?: string | null;
    errorMessage?: string | null;
    retryable?: boolean | null;
    latencyMs?: number | null;
  }): Promise<RunStepRecord>;
  listByRun(runId: string): Promise<RunStepRecord[]>;
  countToolCalls(runId: string, attemptId: string): Promise<number>;
}

export interface EventStore {
  append(input: { runId: string; eventType: string; payload: Record<string, unknown>; version?: number }): Promise<RunEventRecord>;
  listByRun(runId: string, afterSequence: number, limit: number): Promise<RunEventRecord[]>;
  maxSequence(runId: string): Promise<number>;
}

export interface OutboxStore {
  enqueue(input: { topic: string; payload: Record<string, unknown>; dedupeKey: string }): Promise<OutboxRecord>;
  claimDueBatch(limit: number, now: Date): Promise<OutboxRecord[]>;
  markDispatched(id: string, at: Date): Promise<void>;
  markFailed(id: string, error: string, retryAt: Date): Promise<void>;
}

export interface IdempotencyStore {
  /**
   * Atomically reserves (scope, key). Returns `claimed: false` with the existing
   * record when another request already owns the key.
   */
  claim(input: { id: string; scope: string; key: string; tenantId: string; requestHash: string }): Promise<{ claimed: boolean; record: IdempotencyRecord }>;
  complete(id: string, input: { statusCode: number; responseBody: Record<string, unknown>; resourceId: string | null }): Promise<void>;
  fail(id: string, input: { statusCode: number; responseBody: Record<string, unknown> }): Promise<void>;
}

export interface FinancialStore {
  findSupplier(tenantId: string, supplierId: string): Promise<SupplierRecord | null>;
  listSuppliers(tenantId: string, query: { activeOnly: boolean; limit: number }): Promise<SupplierRecord[]>;
  findTransaction(tenantId: string, transactionId: string): Promise<TransactionRecord | null>;
  queryTransactions(query: TransactionQuery): Promise<TransactionRecord[]>;
  /** Sum of refunds already proposed or settled against a transaction. */
  sumRefundsForTransaction(tenantId: string, transactionId: string): Promise<{ activeMinor: number; settledMinor: number }>;
}

export interface ProposalStore {
  insert(input: {
    id: string;
    tenantId: string;
    runId: string;
    supplierId: string;
    transactionId: string;
    amountMinor: number;
    currency: string;
    refundableAmountMinor: number;
    justification: string;
    evidence: Record<string, unknown>;
    status: ProposalStatus;
    reviewedHash: string;
    revision: number;
    policyVersion: string;
    policyDecision: PolicyDecision;
    requiresApproval: boolean;
  }): Promise<RefundProposalRecord>;
  findById(id: string): Promise<RefundProposalRecord | null>;
  findByIdForTenant(id: string, tenantId: string): Promise<RefundProposalRecord | null>;
  listByRun(runId: string): Promise<RefundProposalRecord[]>;
  transition(input: {
    id: string;
    from: ProposalStatus;
    to: ProposalStatus;
    expectedRevision?: number;
  }): Promise<RefundProposalRecord | null>;
  /** Increments the revision and rewrites the review hash (used by re-validation). */
  revise(input: {
    id: string;
    expectedRevision: number;
    patch: Partial<{
      amountMinor: number;
      currency: string;
      supplierId: string;
      transactionId: string;
      justification: string;
      evidence: Record<string, unknown>;
      reviewedHash: string;
    }>;
  }): Promise<RefundProposalRecord | null>;
  countConflicting(tenantId: string, transactionId: string, excludeProposalId: string | null): Promise<number>;
}

export interface ApprovalStore {
  insert(input: {
    id: string;
    tenantId: string;
    runId: string;
    proposalId: string;
    proposalRevision: number;
    proposalHash: string;
    reviewedSnapshot: Record<string, unknown>;
    expiresAt: Date;
  }): Promise<ApprovalRecord>;
  findById(id: string): Promise<ApprovalRecord | null>;
  findByIdForTenant(id: string, tenantId: string): Promise<ApprovalRecord | null>;
  findByProposalId(proposalId: string): Promise<ApprovalRecord | null>;
  /**
   * Conditional decision — the update only applies while the request is still
   * PENDING, so concurrent or repeated decisions cannot produce two outcomes
   * (SRS-APPROVAL-004).
   */
  decide(input: {
    id: string;
    to: 'APPROVED' | 'REJECTED';
    decidedById: string;
    decidedAt: Date;
    reason: string | null;
  }): Promise<ApprovalRecord | null>;
  expire(id: string, at: Date): Promise<ApprovalRecord | null>;
  cancel(id: string, at: Date): Promise<ApprovalRecord | null>;
  findExpired(now: Date, limit: number): Promise<ApprovalRecord[]>;
}

export interface SettlementStore {
  findByProposalId(proposalId: string): Promise<SettlementRecord | null>;
  findByOperationId(operationId: string): Promise<SettlementRecord | null>;
  insert(input: {
    id: string;
    operationId: string;
    tenantId: string;
    runId: string;
    proposalId: string;
    status: SettlementStatus;
  }): Promise<SettlementRecord>;
  transition(input: {
    id: string;
    from: SettlementStatus;
    to: SettlementStatus;
    ledgerEntryId?: string | null;
    lastError?: string | null;
  }): Promise<SettlementRecord | null>;
  incrementAttempts(id: string): Promise<void>;
}

export interface LedgerStore {
  insert(input: {
    id: string;
    tenantId: string;
    operationId: string;
    proposalId: string;
    supplierId: string;
    amountMinor: number;
    currency: string;
    memo: string;
    entryHash: string;
  }): Promise<LedgerEntryRecord>;
  findByOperationId(operationId: string): Promise<LedgerEntryRecord | null>;
  findById(id: string): Promise<LedgerEntryRecord | null>;
  countByProposal(proposalId: string): Promise<number>;
}

export interface AuditStore {
  append(input: AuditInput): Promise<AuditRecord>;
  listByRun(runId: string, limit: number): Promise<AuditRecord[]>;
}

export interface UserStore {
  findBySubject(subject: string): Promise<UserRecord | null>;
  findById(id: string): Promise<UserRecord | null>;
  upsert(input: { tenantId: string; subject: string; email: string; name: string; role: UserRecord['role'] }): Promise<UserRecord>;
}

export interface Store {
  readonly runs: RunStore;
  readonly steps: StepStore;
  readonly events: EventStore;
  readonly outbox: OutboxStore;
  readonly idempotency: IdempotencyStore;
  readonly financial: FinancialStore;
  readonly proposals: ProposalStore;
  readonly approvals: ApprovalStore;
  readonly settlements: SettlementStore;
  readonly ledger: LedgerStore;
  readonly audit: AuditStore;
  readonly users: UserStore;
  /** Runs `fn` inside one database transaction. Nested calls reuse the same tx. */
  transaction<T>(fn: (tx: Store) => Promise<T>): Promise<T>;
}

// ---------------------------------------------------------------------------
// Queue
// ---------------------------------------------------------------------------

export interface RunJobPayload {
  runId: string;
  attemptId: string;
  attemptCount: number;
  /** Why the job exists: initial submission, recovery re-queue or approval resume. */
  reason: 'SUBMITTED' | 'RECOVERY' | 'APPROVAL_RESUME';
  /** Versioned payload guard. */
  version: number;
}

export interface QueuePort {
  /** Publishes a run-execution job. The payload carries stable ids only. */
  enqueueRun(payload: RunJobPayload, options?: { jobId?: string; delayMs?: number }): Promise<void>;
  /** Queue depth by state, for operational visibility (SRS-OBS-003). */
  counts(): Promise<Record<string, number>>;
  close(): Promise<void>;
}

// ---------------------------------------------------------------------------
// LLM port
// ---------------------------------------------------------------------------

export interface LlmMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  /** Present on assistant messages that request tools. */
  toolCalls?: LlmToolCall[];
  /** Present on tool results. */
  toolCallId?: string;
  toolName?: string;
}

export interface LlmToolCall {
  id: string;
  name: string;
  /** Raw, unvalidated arguments from the model. Validated before execution. */
  arguments: unknown;
}

export interface LlmToolSchema {
  name: string;
  description: string;
  /** JSON Schema, generated from the Zod definition. */
  parameters: Record<string, unknown>;
}

export interface LlmTurnResult {
  assistantMessage: LlmMessage;
  toolCalls: LlmToolCall[];
  text: string | null;
  usage: { promptTokens: number; completionTokens: number };
  model: string;
}

export interface LlmTurnRequest {
  system: string;
  messages: LlmMessage[];
  tools: LlmToolSchema[];
  signal: AbortSignal;
  maxOutputTokens: number;
  /** Provider-level retries are bounded by configuration (PR-09). */
  maxRetries: number;
}

export interface LlmProviderPort {
  readonly name: string;
  readonly model: string;
  runTurn(request: LlmTurnRequest): Promise<LlmTurnResult>;
}

// ---------------------------------------------------------------------------
// Clock + logger
// ---------------------------------------------------------------------------

export interface Clock {
  now(): Date;
}

export interface LoggerPort {
  debug(obj: Record<string, unknown>, msg?: string): void;
  info(obj: Record<string, unknown>, msg?: string): void;
  warn(obj: Record<string, unknown>, msg?: string): void;
  error(obj: Record<string, unknown>, msg?: string): void;
}

export type { PolicyDecision, PolicyReviewInput, AnomalyAnalysis, AnomalyFinding };
