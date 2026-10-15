/**
 * Status presentation (FDD §8.2, §14).
 *
 * Every status carries a label, a tone and a short description. Colour is applied
 * from the tone, but the label is always rendered — status is never communicated
 * by colour alone.
 */
import type {
  ApprovalStatus,
  ProposalStatus,
  RunStatus,
  SettlementStatus,
  StepStatus,
  StepType,
} from '@/types/api';

export type Tone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';

export interface StatusMeta {
  label: string;
  tone: Tone;
  /** One-line explanation shown in tooltips, cards and the fallback banner. */
  description: string;
  /** Whether the resource is still in flight from the user's point of view. */
  live?: boolean;
}

export const RUN_STATUS_META: Record<RunStatus, StatusMeta> = {
  PENDING: { label: 'Queued', tone: 'info', description: 'Accepted and waiting for a worker to pick it up.', live: true },
  RUNNING: { label: 'Running', tone: 'info', description: 'The agent is executing the workflow now.', live: true },
  REQUIRES_HUMAN_APPROVAL: {
    label: 'Approval required',
    tone: 'warning',
    description: 'Execution is paused until an authorised reviewer decides the refund proposal.',
    live: true,
  },
  COMPLETED: { label: 'Completed', tone: 'success', description: 'The workflow reached a terminal outcome.' },
  FAILED: { label: 'Failed', tone: 'danger', description: 'The workflow stopped on an error that was not retried.' },
  CANCELLED: { label: 'Cancelled', tone: 'neutral', description: 'A user cancelled the run before it finished.' },
};

export const PROPOSAL_STATUS_META: Record<ProposalStatus, StatusMeta> = {
  REQUIRES_APPROVAL: { label: 'Awaiting approval', tone: 'warning', description: 'Policy requires a human decision before settlement.' },
  POLICY_DENIED: { label: 'Denied by policy', tone: 'danger', description: 'The deterministic policy engine refused the proposal.' },
  APPROVED: { label: 'Approved', tone: 'success', description: 'Approved by an authorised reviewer; settlement is a separate step.' },
  REJECTED: { label: 'Rejected', tone: 'neutral', description: 'Declined by a reviewer. Nothing is settled.' },
  EXPIRED: { label: 'Expired', tone: 'neutral', description: 'No decision was recorded before the approval window closed.' },
  CANCELLED: { label: 'Cancelled', tone: 'neutral', description: 'The proposal was withdrawn before settlement.' },
  SETTLED: { label: 'Settled', tone: 'success', description: 'A simulated settlement operation committed exactly once.' },
};

export const APPROVAL_STATUS_META: Record<ApprovalStatus, StatusMeta> = {
  PENDING: { label: 'Pending decision', tone: 'warning', description: 'Waiting for an authorised reviewer.', live: true },
  APPROVED: { label: 'Approved', tone: 'success', description: 'The reviewer authorised this proposal.' },
  REJECTED: { label: 'Rejected', tone: 'neutral', description: 'The reviewer declined this proposal.' },
  EXPIRED: { label: 'Expired', tone: 'neutral', description: 'The decision window closed without a decision.' },
  CANCELLED: { label: 'Cancelled', tone: 'neutral', description: 'The request was withdrawn.' },
};

export const SETTLEMENT_STATUS_META: Record<SettlementStatus, StatusMeta> = {
  PENDING: { label: 'Pending', tone: 'info', description: 'A settlement attempt is recorded but not committed.', live: true },
  COMMITTED: { label: 'Committed', tone: 'success', description: 'The simulated ledger entry was written exactly once.' },
  FAILED: { label: 'Failed', tone: 'danger', description: 'The attempt failed; no ledger entry was written by it.' },
  UNKNOWN: {
    label: 'Outcome unknown',
    tone: 'warning',
    description: 'The write outcome could not be determined and must be inspected before any further attempt.',
  },
};

export const STEP_STATUS_META: Record<StepStatus, StatusMeta> = {
  STARTED: { label: 'Running', tone: 'info', description: 'The step has started and has not completed yet.', live: true },
  SUCCEEDED: { label: 'Completed', tone: 'success', description: 'The step completed successfully.' },
  FAILED: { label: 'Failed', tone: 'danger', description: 'The step failed.' },
  SKIPPED: { label: 'Skipped', tone: 'neutral', description: 'The step was not executed.' },
};

export const STEP_TYPE_LABELS: Record<StepType, string> = {
  RUN_ACCEPTED: 'Request accepted',
  ATTEMPT_STARTED: 'Execution attempt started',
  MODEL_TURN: 'Model reasoning turn',
  TOOL_CALL: 'Tool execution',
  RESEARCH_REPORT: 'Research report',
  PROPOSAL_CREATED: 'Refund proposal created',
  POLICY_EVALUATION: 'Policy evaluation',
  APPROVAL_REQUIRED: 'Approval requested',
  APPROVAL_DECIDED: 'Approval decided',
  SETTLEMENT: 'Settlement',
  ATTEMPT_FAILED: 'Attempt failed',
  RECOVERY_REQUEUE: 'Recovery re-queue',
};

/** Timeline entries the console groups under "workflow progress" (FDD §7.4B). */
export const WORKFLOW_STEP_TYPES: readonly StepType[] = [
  'RUN_ACCEPTED',
  'ATTEMPT_STARTED',
  'MODEL_TURN',
  'TOOL_CALL',
  'POLICY_EVALUATION',
  'PROPOSAL_CREATED',
  'APPROVAL_REQUIRED',
  'APPROVAL_DECIDED',
  'SETTLEMENT',
  'RESEARCH_REPORT',
  'ATTEMPT_FAILED',
  'RECOVERY_REQUEUE',
];

export const AUDIT_ACTION_LABELS: Record<string, string> = {
  'run.submitted': 'Run submitted',
  'run.queued': 'Run queued for execution',
  'run.started': 'Execution started',
  'run.awaiting_approval': 'Execution paused for approval',
  'run.completed': 'Run completed',
  'run.completed_after_decision': 'Run completed after the approval decision',
  'run.failed': 'Run failed',
  'run.cancelled': 'Run cancelled',
  'run.requeued': 'Run re-queued by recovery',
  'refund_proposal.created': 'Refund proposal created',
  'refund_proposal.denied_by_policy': 'Refund proposal denied by policy',
  'approval.requested': 'Approval requested',
  'approval.approved': 'Approval granted',
  'approval.rejected': 'Approval rejected',
  'approval.expired': 'Approval expired',
  'settlement.requested': 'Settlement requested',
  'settlement.committed': 'Settlement committed (simulated)',
  'settlement.failed': 'Settlement attempt failed',
  'settlement.unknown': 'Settlement outcome unknown',
};

/** Falls back to a humanised form so an unknown action still renders readably. */
export function auditActionLabel(action: string): string {
  return AUDIT_ACTION_LABELS[action] ?? action.replace(/[._]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export const EVENT_TYPE_LABELS: Record<string, string> = {
  'run.accepted': 'Run accepted',
  'run.started': 'Execution started',
  'step.completed': 'Step completed',
  'tool.completed': 'Tool completed',
  'policy.denied': 'Policy denied a proposal',
  'proposal.created': 'Refund proposal created',
  'approval.requested': 'Approval requested',
  'approval.decided': 'Approval decided',
  'run.awaiting_approval': 'Awaiting approval',
  'settlement.committed': 'Settlement committed',
  'run.completed': 'Run completed',
  'run.failed': 'Run failed',
  'run.cancelled': 'Run cancelled',
};

export function eventTypeLabel(type: string): string {
  return EVENT_TYPE_LABELS[type] ?? type.replace(/[._]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export const POLICY_RULE_LABELS: Record<string, string> = {
  'POL-001': 'Amount is within the permitted refund limit',
  'POL-002': 'Proposal cites an existing transaction',
  'POL-003': 'Proposed amount does not exceed the refundable balance',
  'POL-004': 'Supplier is active',
  'POL-005': 'Transaction is in a refundable state',
  'POL-006': 'No conflicting refund already exists for the transaction',
  'POL-007': 'Currency is supported by the policy engine',
  'POL-008': 'Amount is above zero',
  'POL-009': 'Approval threshold applied',
  EXCEEDS_FINDING_BASIS: 'Proposed amount exceeds the deterministic finding basis',
};

export function policyRuleLabel(ruleId: string): string {
  return POLICY_RULE_LABELS[ruleId] ?? ruleId;
}

/** Safe fallback for a status the frontend does not know (FDD §13). */
export const UNKNOWN_STATUS: StatusMeta = {
  label: 'Unrecognised status',
  tone: 'neutral',
  description: 'The backend reported a status this build does not recognise. The identifier is preserved for diagnostics.',
};

export function runStatusMeta(status: string): StatusMeta {
  return RUN_STATUS_META[status as RunStatus] ?? UNKNOWN_STATUS;
}

export function proposalStatusMeta(status: string): StatusMeta {
  return PROPOSAL_STATUS_META[status as ProposalStatus] ?? UNKNOWN_STATUS;
}

export function approvalStatusMeta(status: string): StatusMeta {
  return APPROVAL_STATUS_META[status as ApprovalStatus] ?? UNKNOWN_STATUS;
}

export function settlementStatusMeta(status: string): StatusMeta {
  return SETTLEMENT_STATUS_META[status as SettlementStatus] ?? UNKNOWN_STATUS;
}

export function stepStatusMeta(status: string): StatusMeta {
  return STEP_STATUS_META[status as StepStatus] ?? UNKNOWN_STATUS;
}

// ---------------------------------------------------------------------------
// Role presentation
// ---------------------------------------------------------------------------

export const ROLE_LABELS: Record<string, string> = {
  ANALYST: 'Finance Analyst',
  APPROVER: 'Finance Approver',
  ADMIN: 'Administrator',
};

export function roleLabel(role: string): string {
  return ROLE_LABELS[role] ?? humanizeRole(role);
}

function humanizeRole(role: string): string {
  return role.charAt(0) + role.slice(1).toLowerCase();
}
