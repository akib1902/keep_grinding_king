import { describe, expect, it } from 'vitest';
import {
  APPROVAL_STATUS_META,
  PROPOSAL_STATUS_META,
  RUN_STATUS_META,
  SETTLEMENT_STATUS_META,
  STEP_STATUS_META,
  auditActionLabel,
  approvalStatusMeta,
  eventTypeLabel,
  policyCheckMeta,
  policyRuleFailureLabel,
  policyRuleLabel,
  proposalStatusMeta,
  THRESHOLD_RULE_ID,
  roleLabel,
  runStatusMeta,
  settlementStatusMeta,
  stepStatusMeta,
} from '@/lib/status';
import { APPROVAL_TABS, filterApprovalRows, isActionable, tabCounts, type ApprovalRow } from '@/features/approvals/rows';
import { RUN_STATUSES } from '@/types/api';

describe('status maps', () => {
  it('covers every run status the backend can report', () => {
    for (const status of RUN_STATUSES) {
      const meta = RUN_STATUS_META[status];
      expect(meta.label.length).toBeGreaterThan(0);
      // Colour is never the only signal: a description always accompanies it.
      expect(meta.description.length).toBeGreaterThan(0);
    }
  });

  it('labels the approval pause explicitly', () => {
    expect(RUN_STATUS_META.REQUIRES_HUMAN_APPROVAL.label).toBe('Approval required');
    expect(RUN_STATUS_META.REQUIRES_HUMAN_APPROVAL.tone).toBe('warning');
  });

  it('keeps approval and settlement as distinct concepts', () => {
    // An approval is not a settlement: different labels, different tones.
    expect(APPROVAL_STATUS_META.APPROVED.label).toBe('Approved');
    expect(PROPOSAL_STATUS_META.SETTLED.label).toBe('Settled');
    expect(SETTLEMENT_STATUS_META.COMMITTED.label).toBe('Committed');
    expect(SETTLEMENT_STATUS_META.UNKNOWN.tone).toBe('warning');
  });

  it('marks in-flight statuses as live so they can animate', () => {
    expect(RUN_STATUS_META.RUNNING.live).toBe(true);
    expect(RUN_STATUS_META.COMPLETED.live).toBeUndefined();
    expect(STEP_STATUS_META.STARTED.live).toBe(true);
  });
});

describe('status lookup fallback', () => {
  it('renders an unknown status safely and preserves the identifier', () => {
    const meta = runStatusMeta('AWAITING_SOMETHING_NEW');
    expect(meta.label).toBe('Unrecognised status');
    expect(meta.tone).toBe('neutral');
    expect(meta.description).toContain('identifier is preserved');
  });

  it('applies the fallback to every status family', () => {
    expect(proposalStatusMeta('WEIRD').label).toBe('Unrecognised status');
    expect(approvalStatusMeta('WEIRD').label).toBe('Unrecognised status');
    expect(settlementStatusMeta('WEIRD').label).toBe('Unrecognised status');
    expect(stepStatusMeta('WEIRD').label).toBe('Unrecognised status');
  });

  it('still resolves the statuses it does know', () => {
    expect(runStatusMeta('COMPLETED').label).toBe('Completed');
    expect(proposalStatusMeta('POLICY_DENIED').label).toBe('Denied by policy');
  });
});

describe('labels', () => {
  it('maps known audit actions and humanises unknown ones', () => {
    expect(auditActionLabel('settlement.committed')).toBe('Settlement committed (simulated)');
    expect(auditActionLabel('run.completed_after_decision')).toBe('Run completed after the approval decision');
    expect(auditActionLabel('some.new.action')).toBe('Some New Action');
  });

  it('maps event types and falls back readably', () => {
    expect(eventTypeLabel('policy.denied')).toBe('Policy denied a proposal');
    expect(eventTypeLabel('new.event.type')).toBe('New Event Type');
  });

  it('explains policy rules, including the finding-basis rule', () => {
    // The labels must match the backend's RuleId mapping, not an approximation.
    expect(policyRuleLabel('POL-001')).toMatch(/valid positive amount/i);
    expect(policyRuleLabel('POL-005')).toMatch(/within the refundable balance/i);
    expect(policyRuleLabel('POL-008')).toBe('Approval threshold');
    expect(policyRuleLabel('POL-009')).toMatch(/refundable state/i);
    expect(policyRuleLabel('EXCEEDS_FINDING_BASIS')).toMatch(/deterministic finding basis/i);
    expect(policyRuleLabel('POL-999')).toBe('POL-999');
  });

  it('labels roles', () => {
    expect(roleLabel('ANALYST')).toBe('Finance Analyst');
    expect(roleLabel('APPROVER')).toBe('Finance Approver');
  });

  it('phrases a deny reason as a failure, not as the passing condition', () => {
    // A rule label states what must hold; reading it back as a deny reason would
    // say the opposite of what happened.
    expect(policyRuleLabel('POL-006')).toBe('No conflicting refund already exists for the transaction');
    expect(policyRuleFailureLabel('POL-006')).toBe('POL-006 — a conflicting refund already exists for the transaction');
    expect(policyRuleFailureLabel('EXCEEDS_FINDING_BASIS')).toContain('exceeds the deterministic finding basis');
    expect(policyRuleFailureLabel('POL-999')).toBe('POL-999');
  });
});

describe('policy check interpretation', () => {
  it('renders a passing check as passed', () => {
    expect(policyCheckMeta('POL-001', true)).toEqual({ label: 'Amount is a valid positive amount', word: 'passed', tone: 'success' });
  });

  it('treats a triggered approval threshold as a warning, not a failure', () => {
    // The backend records POL-008 as not-passed when the amount exceeds the
    // threshold, which is what pauses the run for approval.
    const meta = policyCheckMeta('POL-008', false);
    expect(meta.word).toBe('triggered');
    expect(meta.tone).toBe('warning');
    expect(THRESHOLD_RULE_ID).toBe('POL-008');
  });

  it('renders every other failing rule as a denial', () => {
    for (const ruleId of ['POL-001', 'POL-003', 'POL-005', 'POL-006', 'POL-007', 'POL-009']) {
      expect(policyCheckMeta(ruleId, false)).toMatchObject({ word: 'failed', tone: 'danger' });
    }
  });
});

function row(overrides: Partial<ApprovalRow> = {}): ApprovalRow {
  return {
    approvalId: 'ap-1',
    proposalId: 'pr-1',
    runId: 'run-1',
    status: 'PENDING',
    amountMinor: 75000,
    currency: 'USD',
    supplierId: 'sup-1',
    transactionId: 'tx-1',
    policyOutcome: 'REQUIRES_APPROVAL',
    policyVersion: 'v1',
    proposalStatus: 'REQUIRES_APPROVAL',
    requestedAt: '2026-08-01T10:00:00.000Z',
    expiresAt: '2026-08-01T11:00:00.000Z',
    decidedAt: null,
    decidedBy: null,
    reason: null,
    ...overrides,
  };
}

describe('approval inbox tabs', () => {
  it('places cancelled approvals under Expired rather than dropping them', () => {
    const rows = [row({ status: 'CANCELLED', approvalId: 'ap-c' })];
    const counts = tabCounts(rows);
    expect(counts.EXPIRED).toBe(1);
    expect(filterApprovalRows(rows, 'EXPIRED')).toHaveLength(1);
  });

  it('counts each actionable state once', () => {
    const rows = [
      row({ approvalId: 'a', status: 'PENDING' }),
      row({ approvalId: 'b', status: 'APPROVED' }),
      row({ approvalId: 'c', status: 'REJECTED' }),
      row({ approvalId: 'd', status: 'EXPIRED' }),
      row({ approvalId: 'e', status: 'APPROVED' }),
    ];
    expect(tabCounts(rows)).toEqual({ PENDING: 1, APPROVED: 2, REJECTED: 1, EXPIRED: 1 });
    expect(APPROVAL_TABS.map((tab) => tab.id)).toEqual(['PENDING', 'APPROVED', 'REJECTED', 'EXPIRED']);
  });

  it('searches across identifiers', () => {
    const rows = [row({ approvalId: 'aaaa1111' }), row({ approvalId: 'bbbb2222', supplierId: 'acme' })];
    expect(filterApprovalRows(rows, 'PENDING', 'acme')).toHaveLength(1);
    expect(filterApprovalRows(rows, 'PENDING', 'BBBB')).toHaveLength(1);
    expect(filterApprovalRows(rows, 'PENDING', 'nothing')).toHaveLength(0);
  });

  it('treats only unexpired pending rows as actionable', () => {
    const now = new Date('2026-08-01T10:30:00.000Z');
    expect(isActionable(row(), now)).toBe(true);
    expect(isActionable(row({ expiresAt: '2026-08-01T10:10:00.000Z' }), now)).toBe(false);
    expect(isActionable(row({ status: 'APPROVED' }), now)).toBe(false);
  });
});
