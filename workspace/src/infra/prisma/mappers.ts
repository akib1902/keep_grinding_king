/**
 * Row → application-record mappers.
 *
 * Prisma rows are converted here so nothing above the infrastructure layer ever
 * sees a Prisma type. Enum strings are narrowed to the domain unions, which is
 * also where a corrupted status value would surface loudly instead of flowing
 * through the system as a typo.
 */
import type {
  ApprovalRecord,
  AuditRecord,
  IdempotencyRecord,
  LedgerEntryRecord,
  OutboxRecord,
  RefundProposalRecord,
  RunEventRecord,
  RunRecord,
  RunRequest,
  RunStepRecord,
  SettlementRecord,
  SupplierRecord,
  TransactionRecord,
  UserRecord,
} from '../../app/ports.js';
import type { PolicyDecision } from '../../domain/policy.js';
import { APPROVAL_STATUSES, PROPOSAL_STATUSES, RUN_STATUSES, SETTLEMENT_STATUSES, type ApprovalStatus, type ProposalStatus, type RunStatus, type SettlementStatus, type StepType } from '../../domain/state.js';

const STEP_TYPES: readonly string[] = [
  'RUN_ACCEPTED',
  'ATTEMPT_STARTED',
  'MODEL_TURN',
  'TOOL_CALL',
  'RESEARCH_REPORT',
  'PROPOSAL_CREATED',
  'POLICY_EVALUATION',
  'APPROVAL_REQUIRED',
  'APPROVAL_DECIDED',
  'SETTLEMENT',
  'ATTEMPT_FAILED',
  'RECOVERY_REQUEUE',
];

function narrow<T extends string>(value: string, allowed: readonly T[], field: string): T {
  if (!(allowed as readonly string[]).includes(value)) {
    throw new Error(`Unsupported ${field} value "${value}" read from the database.`);
  }
  return value as T;
}

type AnyRow = Record<string, unknown>;

export function mapRun(row: AnyRow): RunRecord {
  return {
    id: row.id as string,
    tenantId: row.tenantId as string,
    ownerId: row.ownerId as string,
    taskType: row.taskType as string,
    status: narrow(row.status as string, RUN_STATUSES, 'run status') as RunStatus,
    request: row.request as RunRequest,
    policyVersion: row.policyVersion as string,
    version: row.version as number,
    attemptId: (row.attemptId as string | null) ?? null,
    attemptCount: row.attemptCount as number,
    heartbeatAt: (row.heartbeatAt as Date | null) ?? null,
    tokenUsage: (row.tokenUsage as RunRecord['tokenUsage']) ?? null,
    result: (row.result as RunRecord['result']) ?? null,
    errorCode: (row.errorCode as string | null) ?? null,
    errorMessage: (row.errorMessage as string | null) ?? null,
    idempotencyKeyId: (row.idempotencyKeyId as string | null) ?? null,
    createdAt: row.createdAt as Date,
    startedAt: (row.startedAt as Date | null) ?? null,
    completedAt: (row.completedAt as Date | null) ?? null,
    updatedAt: row.updatedAt as Date,
  };
}

export function mapStep(row: AnyRow): RunStepRecord {
  return {
    id: row.id as string,
    runId: row.runId as string,
    sequence: row.sequence as number,
    attemptId: (row.attemptId as string | null) ?? null,
    stepType: narrow(row.stepType as string, STEP_TYPES, 'step type') as StepType,
    status: row.status as RunStepRecord['status'],
    summary: (row.summary as string | null) ?? null,
    payload: (row.payload as Record<string, unknown> | null) ?? null,
    errorCode: (row.errorCode as string | null) ?? null,
    errorMessage: (row.errorMessage as string | null) ?? null,
    retryable: (row.retryable as boolean | null) ?? null,
    latencyMs: (row.latencyMs as number | null) ?? null,
    createdAt: row.createdAt as Date,
    completedAt: (row.completedAt as Date | null) ?? null,
  };
}

export function mapEvent(row: AnyRow): RunEventRecord {
  return {
    id: row.id as string,
    runId: row.runId as string,
    sequence: row.sequence as number,
    eventType: row.eventType as string,
    version: row.version as number,
    payload: (row.payload as Record<string, unknown>) ?? {},
    createdAt: row.createdAt as Date,
  };
}

export function mapOutbox(row: AnyRow): OutboxRecord {
  return {
    id: row.id as string,
    topic: row.topic as string,
    payload: (row.payload as Record<string, unknown>) ?? {},
    dedupeKey: row.dedupeKey as string,
    status: narrow(row.status as string, ['PENDING', 'DISPATCHED', 'FAILED'] as const, 'outbox status'),
    attempts: row.attempts as number,
    lastError: (row.lastError as string | null) ?? null,
    availableAt: row.availableAt as Date,
    createdAt: row.createdAt as Date,
    dispatchedAt: (row.dispatchedAt as Date | null) ?? null,
  };
}

export function mapIdempotency(row: AnyRow): IdempotencyRecord {
  return {
    id: row.id as string,
    scope: row.scope as string,
    key: row.key as string,
    tenantId: row.tenantId as string,
    requestHash: row.requestHash as string,
    status: narrow(row.status as string, ['IN_PROGRESS', 'COMPLETED', 'FAILED'] as const, 'idempotency status'),
    statusCode: (row.statusCode as number | null) ?? null,
    responseBody: (row.responseBody as Record<string, unknown> | null) ?? null,
    resourceId: (row.resourceId as string | null) ?? null,
    createdAt: row.createdAt as Date,
    updatedAt: row.updatedAt as Date,
  };
}

export function mapSupplier(row: AnyRow): SupplierRecord {
  return {
    id: row.id as string,
    tenantId: row.tenantId as string,
    externalRef: row.externalRef as string,
    name: row.name as string,
    riskTier: (row.riskTier as string | null) ?? null,
    active: row.active as boolean,
  };
}

export function mapTransaction(row: AnyRow): TransactionRecord {
  return {
    id: row.id as string,
    tenantId: row.tenantId as string,
    supplierId: row.supplierId as string,
    amountMinor: row.amountMinor as number,
    currency: row.currency as string,
    occurredAt: row.occurredAt as Date,
    invoiceRef: (row.invoiceRef as string | null) ?? null,
    description: row.description as string,
    category: row.category as string,
    status: row.status as string,
  };
}

export function mapProposal(row: AnyRow): RefundProposalRecord {
  return {
    id: row.id as string,
    tenantId: row.tenantId as string,
    runId: row.runId as string,
    supplierId: row.supplierId as string,
    transactionId: row.transactionId as string,
    amountMinor: row.amountMinor as number,
    currency: row.currency as string,
    refundableAmountMinor: row.refundableAmountMinor as number,
    justification: row.justification as string,
    evidence: (row.evidence as Record<string, unknown>) ?? {},
    status: narrow(row.status as string, PROPOSAL_STATUSES, 'proposal status') as ProposalStatus,
    reviewedHash: row.reviewedHash as string,
    revision: row.revision as number,
    policyVersion: row.policyVersion as string,
    policyDecision: row.policyDecision as PolicyDecision,
    requiresApproval: row.requiresApproval as boolean,
    createdAt: row.createdAt as Date,
    updatedAt: row.updatedAt as Date,
  };
}

export function mapApproval(row: AnyRow): ApprovalRecord {
  return {
    id: row.id as string,
    tenantId: row.tenantId as string,
    runId: row.runId as string,
    proposalId: row.proposalId as string,
    status: narrow(row.status as string, APPROVAL_STATUSES, 'approval status') as ApprovalStatus,
    proposalRevision: row.proposalRevision as number,
    proposalHash: row.proposalHash as string,
    reviewedSnapshot: (row.reviewedSnapshot as Record<string, unknown>) ?? {},
    expiresAt: row.expiresAt as Date,
    decidedAt: (row.decidedAt as Date | null) ?? null,
    decidedById: (row.decidedById as string | null) ?? null,
    decisionReason: (row.decisionReason as string | null) ?? null,
    createdAt: row.createdAt as Date,
  };
}

export function mapSettlement(row: AnyRow): SettlementRecord {
  return {
    id: row.id as string,
    operationId: row.operationId as string,
    tenantId: row.tenantId as string,
    runId: row.runId as string,
    proposalId: row.proposalId as string,
    status: narrow(row.status as string, SETTLEMENT_STATUSES, 'settlement status') as SettlementStatus,
    attempts: row.attempts as number,
    ledgerEntryId: (row.ledgerEntryId as string | null) ?? null,
    lastError: (row.lastError as string | null) ?? null,
    createdAt: row.createdAt as Date,
    committedAt: (row.committedAt as Date | null) ?? null,
  };
}

export function mapLedgerEntry(row: AnyRow): LedgerEntryRecord {
  return {
    id: row.id as string,
    tenantId: row.tenantId as string,
    operationId: row.operationId as string,
    proposalId: row.proposalId as string,
    supplierId: row.supplierId as string,
    entryType: 'REFUND',
    amountMinor: row.amountMinor as number,
    currency: row.currency as string,
    memo: row.memo as string,
    entryHash: row.entryHash as string,
    createdAt: row.createdAt as Date,
  };
}

export function mapAudit(row: AnyRow): AuditRecord {
  return {
    id: row.id as string,
    tenantId: row.tenantId as string,
    runId: (row.runId as string | null) ?? null,
    actorType: row.actorType as AuditRecord['actorType'],
    actorId: (row.actorId as string | null) ?? null,
    action: row.action as string,
    targetType: row.targetType as string,
    targetId: (row.targetId as string | null) ?? null,
    metadata: (row.metadata as Record<string, unknown> | null) ?? null,
    createdAt: row.createdAt as Date,
  };
}

export function mapUser(row: AnyRow): UserRecord {
  return {
    id: row.id as string,
    tenantId: row.tenantId as string,
    email: row.email as string,
    name: row.name as string,
    subject: row.subject as string,
    role: narrow(row.role as string, ['ANALYST', 'APPROVER', 'ADMIN'] as const, 'user role'),
    active: row.active as boolean,
  };
}
