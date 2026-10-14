/**
 * State machines — SRS-STATE-001..007, SRS-APPROVAL-004/005, SRS-SETTLE.
 *
 * The tests iterate the declared transition tables and assert that *every* pair
 * not listed is rejected, so a new status cannot be slipped in without a decision
 * about how it may be entered and left.
 */
import { describe, expect, it } from 'vitest';
import {
  APPROVAL_STATUSES,
  APPROVAL_TRANSITIONS,
  PROPOSAL_STATUSES,
  PROPOSAL_TRANSITIONS,
  RUN_STATUSES,
  RUN_TRANSITIONS,
  SETTLEMENT_STATUSES,
  SETTLEMENT_TRANSITIONS,
  assertApprovalTransition,
  assertProposalTransition,
  assertRunTransition,
  assertSettlementTransition,
  isTerminalRunStatus,
  type ApprovalStatus,
  type ProposalStatus,
  type RunStatus,
  type SettlementStatus,
} from '../../src/domain/state.js';
import { isAppError } from '../../src/domain/errors.js';

describe('run lifecycle', () => {
  it('permits every declared transition', () => {
    for (const from of RUN_STATUSES) {
      for (const to of RUN_TRANSITIONS[from]) {
        expect(() => assertRunTransition(from, to)).not.toThrow();
      }
    }
  });

  it('rejects every undeclared transition', () => {
    let rejected = 0;
    for (const from of RUN_STATUSES) {
      for (const to of RUN_STATUSES) {
        if (from === to) continue;
        if (RUN_TRANSITIONS[from].includes(to)) continue;
        expect(() => assertRunTransition(from, to)).toThrow();
        rejected += 1;
      }
    }
    // 36 ordered pairs minus 6 identity pairs minus 13 declared transitions.
    expect(rejected).toBe(17);
  });

  it('never jumps from PENDING straight to COMPLETED (SRS-STATE-002)', () => {
    expect(() => assertRunTransition('PENDING', 'COMPLETED')).toThrow(/cannot complete without executing/);
  });

  it('treats COMPLETED and CANCELLED as terminal but FAILED as recoverable', () => {
    expect(isTerminalRunStatus('COMPLETED')).toBe(true);
    expect(isTerminalRunStatus('CANCELLED')).toBe(true);
    expect(isTerminalRunStatus('FAILED')).toBe(true);
    expect(isTerminalRunStatus('RUNNING')).toBe(false);
    // FAILED is terminal for queue delivery, yet recovery may re-queue it while
    // attempts remain — that edge is declared explicitly.
    expect(RUN_TRANSITIONS.FAILED).toEqual(['PENDING']);
    expect(RUN_TRANSITIONS.COMPLETED).toEqual([]);
    expect(RUN_TRANSITIONS.CANCELLED).toEqual([]);
  });

  it('allows a run to resume after approval and to finish without settling', () => {
    expect(RUN_TRANSITIONS.REQUIRES_HUMAN_APPROVAL).toContain('RUNNING');
    expect(RUN_TRANSITIONS.REQUIRES_HUMAN_APPROVAL).toContain('COMPLETED');
  });

  it('raises a typed conflict error with the allowed transitions', () => {
    try {
      assertRunTransition('COMPLETED', 'RUNNING');
      throw new Error('expected a conflict');
    } catch (error) {
      expect(isAppError(error)).toBe(true);
      if (isAppError(error)) {
        expect(error.code).toBe('INVALID_STATE_TRANSITION');
        expect(error.httpStatus).toBe(409);
        expect(error.details).toMatchObject({ from: 'COMPLETED', to: 'RUNNING', allowed: [] });
      }
    }
  });
});

describe('refund proposal lifecycle', () => {
  it('permits only declared transitions', () => {
    for (const from of PROPOSAL_STATUSES) {
      for (const to of PROPOSAL_STATUSES) {
        if (from === to) continue;
        const declared = PROPOSAL_TRANSITIONS[from].includes(to);
        if (declared) expect(() => assertProposalTransition(from, to)).not.toThrow();
        else expect(() => assertProposalTransition(from, to)).toThrow();
      }
    }
  });

  it('never lets a denied, rejected, expired or cancelled proposal be settled', () => {
    for (const status of ['POLICY_DENIED', 'REJECTED', 'EXPIRED', 'CANCELLED'] as ProposalStatus[]) {
      expect(PROPOSAL_TRANSITIONS[status]).not.toContain('SETTLED');
      expect(() => assertProposalTransition(status, 'SETTLED')).toThrow();
    }
  });

  it('only permits settlement from APPROVED', () => {
    const settleable = PROPOSAL_STATUSES.filter((status) => PROPOSAL_TRANSITIONS[status].includes('SETTLED'));
    expect(settleable).toEqual(['APPROVED']);
  });

  it('treats a settled proposal as final', () => {
    expect(PROPOSAL_TRANSITIONS.SETTLED).toEqual([]);
  });
});

describe('approval lifecycle', () => {
  it('permits only declared transitions and makes every decision final', () => {
    for (const from of APPROVAL_STATUSES) {
      for (const to of APPROVAL_STATUSES) {
        if (from === to) continue;
        const declared = APPROVAL_TRANSITIONS[from].includes(to);
        if (declared) expect(() => assertApprovalTransition(from, to)).not.toThrow();
        else expect(() => assertApprovalTransition(from, to)).toThrow();
      }
    }
  });

  it('prevents a second decision on an already-decided request (SRS-APPROVAL-004)', () => {
    for (const decided of ['APPROVED', 'REJECTED', 'EXPIRED', 'CANCELLED'] as ApprovalStatus[]) {
      expect(APPROVAL_TRANSITIONS[decided]).toEqual([]);
    }
  });
});

describe('settlement lifecycle', () => {
  it('permits only declared transitions', () => {
    for (const from of SETTLEMENT_STATUSES) {
      for (const to of SETTLEMENT_STATUSES) {
        if (from === to) continue;
        const declared = SETTLEMENT_TRANSITIONS[from].includes(to);
        if (declared) expect(() => assertSettlementTransition(from, to)).not.toThrow();
        else expect(() => assertSettlementTransition(from, to)).toThrow();
      }
    }
  });

  it('lets an unknown outcome be resolved by inspection, never skipped', () => {
    expect(SETTLEMENT_TRANSITIONS.UNKNOWN).toEqual(['COMMITTED', 'FAILED']);
    expect(SETTLEMENT_TRANSITIONS.COMMITTED).toEqual([]);
  });

  it('keeps every run status covered by the transition table', () => {
    const declared = Object.keys(RUN_TRANSITIONS) as RunStatus[];
    expect(declared.sort()).toEqual([...RUN_STATUSES].sort());
    const settlementDeclared = Object.keys(SETTLEMENT_TRANSITIONS) as SettlementStatus[];
    expect(settlementDeclared.sort()).toEqual([...SETTLEMENT_STATUSES].sort());
  });
});
