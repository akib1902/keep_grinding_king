/**
 * Domain types mirroring the backend's documented JSON contracts
 * (`docs/API.md` in the backend repository is the source of truth).
 *
 * Nothing here is invented by the frontend: every field below appears in a real
 * response from the Fastify API.
 */

export type Role = 'ANALYST' | 'APPROVER' | 'ADMIN';

export const RUN_STATUSES = [
  'PENDING',
  'RUNNING',
  'REQUIRES_HUMAN_APPROVAL',
  'COMPLETED',
  'FAILED',
  'CANCELLED',
] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];

export type ProposalStatus =
  | 'REQUIRES_APPROVAL'
  | 'POLICY_DENIED'
  | 'APPROVED'
  | 'REJECTED'
  | 'EXPIRED'
  | 'CANCELLED'
  | 'SETTLED';

export type ApprovalStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'EXPIRED' | 'CANCELLED';

export type SettlementStatus = 'PENDING' | 'COMMITTED' | 'FAILED' | 'UNKNOWN';

export type StepStatus = 'STARTED' | 'SUCCEEDED' | 'FAILED' | 'SKIPPED';

export type StepType =
  | 'RUN_ACCEPTED'
  | 'ATTEMPT_STARTED'
  | 'MODEL_TURN'
  | 'TOOL_CALL'
  | 'RESEARCH_REPORT'
  | 'PROPOSAL_CREATED'
  | 'POLICY_EVALUATION'
  | 'APPROVAL_REQUIRED'
  | 'APPROVAL_DECIDED'
  | 'SETTLEMENT'
  | 'ATTEMPT_FAILED'
  | 'RECOVERY_REQUEUE';

export type ActorType = 'USER' | 'AGENT' | 'SYSTEM';

export type TaskType = 'SPEND_ANOMALY_RESEARCH' | 'SUPPLIER_DISCREPANCY_REVIEW';

export interface RunRequest {
  task: string;
  taskType: TaskType;
  from: string;
  to: string;
  currency: string;
  supplierIds?: string[];
  notes?: string;
}

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  modelTurns: number;
}

export interface AnomalyFinding {
  id: string;
  ruleId: string;
  ruleVersion: string;
  severity: 'LOW' | 'MEDIUM' | 'HIGH';
  title: string;
  observations: string[];
  evidence: {
    transactionIds: string[];
    supplierIds: string[];
    metrics: Record<string, number | string>;
  };
  refundEligible: boolean;
  suggestedRefundMinor: number;
}

export interface ResearchReport {
  taskType: string;
  window: { from: string; to: string };
  transactionCount: number;
  totalSpendMinor: number;
  currency: string;
  ruleVersion: string;
  findings: AnomalyFinding[];
  interpretation: {
    model: string;
    provider: string;
    summary: string;
    highlightedFindingIds: string[];
  };
  limitations: string[];
  proposalIds: string[];
  approval?: { approvalId: string; status: ApprovalStatus; proposalId: string; reason?: string };
  settlement?: {
    operationId: string;
    status: SettlementStatus;
    ledgerEntryId: string | null;
    amountMinor: number;
    currency: string;
  };
}

export interface Run {
  runId: string;
  tenantId: string;
  ownerId: string;
  taskType: TaskType;
  status: RunStatus;
  request: RunRequest;
  policyVersion: string;
  attemptCount: number;
  attemptId: string | null;
  tokenUsage: TokenUsage | null;
  result: { report: ResearchReport; generatedAt: string } | null;
  error: { code: string; message: string } | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
}

export interface RunStep {
  stepId: string;
  sequence: number;
  attemptId: string | null;
  type: StepType;
  status: StepStatus;
  summary: string | null;
  payload: Record<string, unknown> | null;
  errorCode: string | null;
  errorMessage: string | null;
  retryable: boolean | null;
  latencyMs: number | null;
  createdAt: string;
  completedAt: string | null;
}

export interface RunEvent {
  eventId: string;
  sequence: number;
  type: string;
  version: number;
  payload: Record<string, unknown>;
  createdAt: string;
}

export interface AuditRecord {
  auditId: string;
  actorType: ActorType;
  actorId: string | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

export interface ProposalSummary {
  proposalId: string;
  status: ProposalStatus;
  amountMinor: number;
  currency: string;
  supplierId: string;
  transactionId: string;
  revision: number;
  policyOutcome: string;
  policyVersion: string;
  requiresApproval: boolean;
  createdAt: string;
}

export interface ApprovalSummary {
  approvalId: string;
  proposalId: string;
  status: ApprovalStatus;
  expiresAt: string;
  decidedAt: string | null;
  decidedBy: string | null;
  reason: string | null;
}

export interface SettlementSummary {
  operationId: string;
  status: SettlementStatus;
  ledgerEntryId: string | null;
  attempts: number;
}

export interface RunHistory {
  runId: string;
  status: RunStatus;
  proposals: ProposalSummary[];
  approvals: ApprovalSummary[];
  settlements: SettlementSummary[];
}

export interface PolicyCheck {
  ruleId: string;
  passed: boolean;
  detail?: string;
}

export interface ProposalDetail {
  proposalId: string;
  runId: string;
  status: ProposalStatus;
  supplierId: string;
  transactionId: string;
  amountMinor: number;
  currency: string;
  refundableAmountMinor: number;
  justification: string;
  evidence: Record<string, unknown>;
  revision: number;
  reviewedHash: string;
  requiresApproval: boolean;
  policy: {
    version: string;
    outcome: string;
    decisionHash: string;
    checks: PolicyCheck[];
    denyReasons: string[];
  };
  approval: { approvalId: string; status: ApprovalStatus; expiresAt: string } | null;
  settlement: { operationId: string; status: SettlementStatus; ledgerEntryId: string | null } | null;
  createdAt: string;
}

export interface ReviewedSnapshot {
  proposalId: string;
  revision: number;
  reviewedHash: string;
  supplierId: string;
  supplierName: string | null;
  transactionId: string;
  amountMinor: number;
  currency: string;
  refundableAmountMinor: number;
  justification: string;
  policyVersion: string;
  policyOutcome: string;
  evidence: Record<string, unknown>;
}

export interface ApprovalDetail {
  approvalId: string;
  runId: string;
  proposalId: string;
  status: ApprovalStatus;
  expiresAt: string;
  proposalRevision: number;
  proposalHash: string;
  reviewed: ReviewedSnapshot;
  decidedAt: string | null;
  decidedBy: string | null;
  reason: string | null;
  links: { proposal: string; run: string };
}

export interface LedgerOperation {
  operationId: string;
  proposalId: string;
  runId: string;
  status: SettlementStatus;
  attempts: number;
  lastError: string | null;
  committedAt: string | null;
  ledgerEntry: {
    ledgerEntryId: string;
    entryType: string;
    amountMinor: number;
    currency: string;
    supplierId: string;
    memo: string | null;
    entryHash: string;
    createdAt: string;
    simulated: boolean;
  } | null;
}

export interface DecisionResult {
  approvalId: string;
  status: ApprovalStatus;
  proposalId: string;
  runId: string;
  resumption: string;
}

export interface SubmitRunResult {
  runId: string;
  status: RunStatus;
  idempotentReplay: boolean;
  links: { self: string; steps: string; events: string; stream: string };
}

export interface TokenResponse {
  token: string;
  tokenType: 'Bearer';
  expiresInSeconds: number;
  user: { userId: string; tenantId: string; role: Role; email: string };
  warning: string;
}

export interface ReadinessResponse {
  status: 'ready' | 'not_ready';
  checks: Record<string, string>;
}

/** JWT claims the backend actually puts in the token. */
export interface SessionClaims {
  sub: string;
  tenant_id: string;
  email: string;
  role: Role;
  iss: string;
  aud: string;
  iat: number;
  exp: number;
}
