/**
 * Explicit state machines — SRS-STATE-001..007, SRS-APPROVAL-005, SRS-SETTLE.
 *
 * These unions mirror the Prisma enums. Only the guards in this module authorise
 * a status change; services never write a status column without going through
 * them.
 *
 * Rejection and expiry are NOT completion: they are represented explicitly and
 * never interpreted as a successful settlement (PRD §6, SRS-STATE-007).
 */
import { AppError, ErrorCode } from './errors.js';

// ---------------------------------------------------------------------------
// Steps
// ---------------------------------------------------------------------------

/** Recorded units of workflow activity (mirrors the Prisma `StepType` enum). */
export const STEP_TYPES = [
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
] as const;
export type StepType = (typeof STEP_TYPES)[number];

// ---------------------------------------------------------------------------
// Run lifecycle
// ---------------------------------------------------------------------------

export const RUN_STATUSES = [
  'PENDING',
  'RUNNING',
  'REQUIRES_HUMAN_APPROVAL',
  'COMPLETED',
  'FAILED',
  'CANCELLED',
] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];

/**
 * Permitted run transitions.
 *
 * Notes on the non-obvious edges:
 *  * `RUNNING → PENDING` is the recovery re-queue edge: a stale attempt whose
 *    lease expired returns to the queue with attempts remaining (SRS-QUEUE-005).
 *  * `FAILED → PENDING` is the bounded retry edge, only reachable from the
 *    recovery service while `attemptCount < maxAttempts`.
 *  * `REQUIRES_HUMAN_APPROVAL → COMPLETED` happens when a proposal is rejected or
 *    expires: the run finishes with a report describing that no settlement
 *    occurred. It is never a settlement.
 */
export const RUN_TRANSITIONS: Readonly<Record<RunStatus, readonly RunStatus[]>> = {
  PENDING: ['RUNNING', 'CANCELLED', 'FAILED'],
  RUNNING: ['REQUIRES_HUMAN_APPROVAL', 'COMPLETED', 'FAILED', 'CANCELLED', 'PENDING'],
  REQUIRES_HUMAN_APPROVAL: ['RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED'],
  COMPLETED: [],
  FAILED: ['PENDING'],
  CANCELLED: [],
};

export const TERMINAL_RUN_STATUSES: readonly RunStatus[] = ['COMPLETED', 'FAILED', 'CANCELLED'];

export function isTerminalRunStatus(status: RunStatus): boolean {
  return TERMINAL_RUN_STATUSES.includes(status);
}

export function canTransitionRun(from: RunStatus, to: RunStatus): boolean {
  return RUN_TRANSITIONS[from].includes(to);
}

export function assertRunTransition(from: RunStatus, to: RunStatus): void {
  if (from === to) return;
  // SRS-STATE-002: PENDING may never jump straight to COMPLETED. Checked before
  // the table lookup so the specific rule produces the specific message.
  if (from === 'PENDING' && to === 'COMPLETED') {
    throw new AppError({
      code: ErrorCode.INVALID_STATE_TRANSITION,
      message: 'A run cannot complete without executing the workflow.',
      category: 'CONFLICT',
      httpStatus: 409,
      retryable: false,
      details: { from, to, allowed: RUN_TRANSITIONS[from] },
    });
  }
  if (!canTransitionRun(from, to)) {
    throw new AppError({
      code: ErrorCode.INVALID_STATE_TRANSITION,
      message: `Run status cannot change from ${from} to ${to}.`,
      category: 'CONFLICT',
      httpStatus: 409,
      retryable: false,
      details: { from, to, allowed: RUN_TRANSITIONS[from] },
    });
  }
}

/** Runs that still consume orchestration resources. */
export function isActiveRunStatus(status: RunStatus): boolean {
  return status === 'PENDING' || status === 'RUNNING';
}

// ---------------------------------------------------------------------------
// Refund proposal lifecycle
// ---------------------------------------------------------------------------

export const PROPOSAL_STATUSES = [
  'REQUIRES_APPROVAL',
  'POLICY_DENIED',
  'APPROVED',
  'REJECTED',
  'EXPIRED',
  'CANCELLED',
  'SETTLED',
] as const;
export type ProposalStatus = (typeof PROPOSAL_STATUSES)[number];

export const PROPOSAL_TRANSITIONS: Readonly<Record<ProposalStatus, readonly ProposalStatus[]>> = {
  REQUIRES_APPROVAL: ['APPROVED', 'REJECTED', 'EXPIRED', 'CANCELLED'],
  APPROVED: ['SETTLED', 'CANCELLED'],
  POLICY_DENIED: [],
  REJECTED: [],
  EXPIRED: [],
  CANCELLED: [],
  SETTLED: [],
};

/** Proposal statuses that permit (or forbid) a settlement attempt. */
export const SETTLEABLE_PROPOSAL_STATUSES: readonly ProposalStatus[] = ['APPROVED'];

export function canTransitionProposal(from: ProposalStatus, to: ProposalStatus): boolean {
  return PROPOSAL_TRANSITIONS[from].includes(to);
}

export function assertProposalTransition(from: ProposalStatus, to: ProposalStatus): void {
  if (from === to) return;
  if (!canTransitionProposal(from, to)) {
    throw new AppError({
      code: ErrorCode.INVALID_STATE_TRANSITION,
      message: `Refund proposal status cannot change from ${from} to ${to}.`,
      category: 'CONFLICT',
      httpStatus: 409,
      retryable: false,
      details: { from, to, allowed: PROPOSAL_TRANSITIONS[from] },
    });
  }
}

// ---------------------------------------------------------------------------
// Approval lifecycle
// ---------------------------------------------------------------------------

export const APPROVAL_STATUSES = ['PENDING', 'APPROVED', 'REJECTED', 'EXPIRED', 'CANCELLED'] as const;
export type ApprovalStatus = (typeof APPROVAL_STATUSES)[number];

export const APPROVAL_TRANSITIONS: Readonly<Record<ApprovalStatus, readonly ApprovalStatus[]>> = {
  PENDING: ['APPROVED', 'REJECTED', 'EXPIRED', 'CANCELLED'],
  APPROVED: [],
  REJECTED: [],
  EXPIRED: [],
  CANCELLED: [],
};

export function canTransitionApproval(from: ApprovalStatus, to: ApprovalStatus): boolean {
  return APPROVAL_TRANSITIONS[from].includes(to);
}

export function assertApprovalTransition(from: ApprovalStatus, to: ApprovalStatus): void {
  if (from === to) return;
  if (!canTransitionApproval(from, to)) {
    throw new AppError({
      code: ErrorCode.APPROVAL_NOT_PENDING,
      message: `Approval request is already ${from} and cannot become ${to}.`,
      category: 'CONFLICT',
      httpStatus: 409,
      retryable: false,
      details: { from, to },
    });
  }
}

// ---------------------------------------------------------------------------
// Settlement lifecycle
// ---------------------------------------------------------------------------

export const SETTLEMENT_STATUSES = ['PENDING', 'COMMITTED', 'FAILED', 'UNKNOWN'] as const;
export type SettlementStatus = (typeof SETTLEMENT_STATUSES)[number];

export const SETTLEMENT_TRANSITIONS: Readonly<Record<SettlementStatus, readonly SettlementStatus[]>> = {
  PENDING: ['COMMITTED', 'FAILED', 'UNKNOWN'],
  UNKNOWN: ['COMMITTED', 'FAILED'],
  COMMITTED: [],
  FAILED: [],
};

export function canTransitionSettlement(from: SettlementStatus, to: SettlementStatus): boolean {
  return SETTLEMENT_TRANSITIONS[from].includes(to);
}

export function assertSettlementTransition(from: SettlementStatus, to: SettlementStatus): void {
  if (from === to) return;
  if (!canTransitionSettlement(from, to)) {
    throw new AppError({
      code: ErrorCode.INVALID_STATE_TRANSITION,
      message: `Settlement operation cannot change from ${from} to ${to}.`,
      category: 'CONFLICT',
      httpStatus: 409,
      retryable: false,
      details: { from, to },
    });
  }
}
