/**
 * Deterministic financial policy — PR-06, SRS-POLICY-004..009.
 *
 * The centrepiece is the boundary case: exactly USD 500.00 is auto-allowed, one
 * cent more requires a human. If that ever flips, this file fails loudly.
 */
import { describe, expect, it } from 'vitest';
import {
  POLICY_V1,
  RuleId,
  assertPolicyAllowsSettlement,
  evaluateRefundProposal,
  resolvePolicy,
  type PolicyReviewInput,
} from '../../src/domain/policy.js';

function baseInput(overrides: Partial<PolicyReviewInput> = {}): PolicyReviewInput {
  return {
    amountMinor: 10_000,
    currency: 'USD',
    transactionId: 'tx-1',
    supplierId: 'sup-1',
    transaction: {
      id: 'tx-1',
      supplierId: 'sup-1',
      amountMinor: 250_000,
      currency: 'USD',
      status: 'POSTED',
      occurredAt: '2026-08-01T00:00:00.000Z',
    },
    supplier: { id: 'sup-1', active: true },
    refundableAmountMinor: 250_000,
    existingRefundMinor: 0,
    hasConflictingActiveRefund: false,
    ...overrides,
  };
}

describe('policy: determinism', () => {
  it('produces byte-identical decisions for identical input and policy version', () => {
    const first = evaluateRefundProposal(baseInput());
    const second = evaluateRefundProposal(baseInput());
    expect(second).toEqual(first);
    expect(second.decisionHash).toBe(first.decisionHash);
  });

  it('produces a different decision hash when the amount changes', () => {
    const a = evaluateRefundProposal(baseInput({ amountMinor: 10_000 }));
    const b = evaluateRefundProposal(baseInput({ amountMinor: 10_001 }));
    expect(a.decisionHash).not.toBe(b.decisionHash);
  });

  it('records the policy version and every rule it evaluated', () => {
    const decision = evaluateRefundProposal(baseInput());
    expect(decision.policyVersion).toBe('v1');
    const ruleIds = decision.checks.map((check) => check.ruleId);
    expect(ruleIds).toContain(RuleId.AMOUNT_VALID);
    expect(ruleIds).toContain(RuleId.NO_CONFLICTING_REFUND);
    expect(ruleIds).toContain(RuleId.APPROVAL_THRESHOLD);
  });

  it('refuses an unknown policy version instead of guessing', () => {
    expect(() => resolvePolicy('v99')).toThrow(/Unknown policy version/);
  });
});

describe('policy: approval threshold boundary (BUS-RULE-01)', () => {
  it('auto-allows exactly the threshold', () => {
    const decision = evaluateRefundProposal(baseInput({ amountMinor: POLICY_V1.approvalThresholdMinor }));
    expect(decision.outcome).toBe('ALLOW');
    expect(decision.requiresApproval).toBe(false);
  });

  it('requires approval one minor unit above the threshold', () => {
    const decision = evaluateRefundProposal(baseInput({ amountMinor: POLICY_V1.approvalThresholdMinor + 1 }));
    expect(decision.outcome).toBe('REQUIRES_APPROVAL');
    expect(decision.requiresApproval).toBe(true);
    expect(decision.checks.find((check) => check.ruleId === RuleId.APPROVAL_THRESHOLD)?.passed).toBe(false);
  });

  it('honours a configured threshold override', () => {
    const policy = resolvePolicy('v1', { approvalThresholdMinor: 1_000 });
    const decision = evaluateRefundProposal(baseInput({ amountMinor: 1_001 }), policy);
    expect(decision.outcome).toBe('REQUIRES_APPROVAL');
  });
});

describe('policy: hard denials', () => {
  const cases: Array<{ name: string; input: Partial<PolicyReviewInput>; rule: string }> = [
    { name: 'missing transaction', input: { transaction: null }, rule: RuleId.TRANSACTION_EXISTS },
    { name: 'unknown supplier', input: { supplier: null }, rule: RuleId.SUPPLIER_VALID },
    { name: 'inactive supplier', input: { supplier: { id: 'sup-1', active: false } }, rule: RuleId.SUPPLIER_VALID },
    { name: 'supplier not owning the transaction', input: { supplierId: 'sup-other' }, rule: RuleId.SUPPLIER_VALID },
    { name: 'amount above the refundable balance', input: { refundableAmountMinor: 9_999 }, rule: RuleId.WITHIN_REFUNDABLE },
    { name: 'conflicting refund in flight', input: { hasConflictingActiveRefund: true }, rule: RuleId.NO_CONFLICTING_REFUND },
    { name: 'unsupported currency', input: { currency: 'EUR' }, rule: RuleId.CURRENCY_SUPPORTED },
    { name: 'non-positive amount', input: { amountMinor: 0 }, rule: RuleId.AMOUNT_VALID },
    { name: 'amount above the policy ceiling', input: { amountMinor: POLICY_V1.maxRefundMinor + 1, refundableAmountMinor: POLICY_V1.maxRefundMinor + 1 }, rule: RuleId.MAX_REFUND_CEILING },
  ];

  for (const testCase of cases) {
    it(`denies when there is a ${testCase.name}`, () => {
      const decision = evaluateRefundProposal(baseInput(testCase.input));
      expect(decision.outcome).toBe('DENY');
      expect(decision.denyReasons).toContain(testCase.rule);
      expect(decision.requiresApproval).toBe(false);
    });
  }

  it('reports every failing rule, not just the first', () => {
    const decision = evaluateRefundProposal(baseInput({ transaction: null, supplier: null, amountMinor: 0 }));
    expect(decision.denyReasons).toEqual(
      expect.arrayContaining([RuleId.AMOUNT_VALID, RuleId.TRANSACTION_EXISTS, RuleId.SUPPLIER_VALID]),
    );
  });
});

describe('policy: settlement re-validation (SRS-POLICY-008/009)', () => {
  const proposal = { reviewedHash: 'hash-a', revision: 1 };

  it('refuses settlement when policy denies', () => {
    const decision = evaluateRefundProposal(baseInput({ transaction: null }));
    const result = assertPolicyAllowsSettlement(decision, null, proposal);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('POLICY_DENIED');
  });

  it('refuses settlement above the threshold with no approval at all', () => {
    const decision = evaluateRefundProposal(baseInput({ amountMinor: 100_000 }));
    const result = assertPolicyAllowsSettlement(decision, null, proposal);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('APPROVAL_REQUIRED');
  });

  it('refuses settlement when the approval is still pending', () => {
    const decision = evaluateRefundProposal(baseInput({ amountMinor: 100_000 }));
    const result = assertPolicyAllowsSettlement(decision, { status: 'PENDING', proposalHash: 'hash-a', proposalRevision: 1 }, proposal);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('APPROVAL_NOT_APPROVED');
  });

  it('refuses settlement when the approval is rejected', () => {
    const decision = evaluateRefundProposal(baseInput({ amountMinor: 100_000 }));
    const result = assertPolicyAllowsSettlement(decision, { status: 'REJECTED', proposalHash: 'hash-a', proposalRevision: 1 }, proposal);
    expect(result.ok).toBe(false);
  });

  it('refuses a stale approval whose hash no longer matches the proposal', () => {
    const decision = evaluateRefundProposal(baseInput({ amountMinor: 100_000 }));
    const result = assertPolicyAllowsSettlement(decision, { status: 'APPROVED', proposalHash: 'hash-old', proposalRevision: 1 }, proposal);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('APPROVAL_HASH_MISMATCH');
  });

  it('refuses an approval bound to an older proposal revision', () => {
    const decision = evaluateRefundProposal(baseInput({ amountMinor: 100_000 }));
    const result = assertPolicyAllowsSettlement(decision, { status: 'APPROVED', proposalHash: 'hash-a', proposalRevision: 0 }, proposal);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('APPROVAL_HASH_MISMATCH');
  });

  it('allows settlement for an approved, hash-matching proposal', () => {
    const decision = evaluateRefundProposal(baseInput({ amountMinor: 100_000 }));
    const result = assertPolicyAllowsSettlement(decision, { status: 'APPROVED', proposalHash: 'hash-a', proposalRevision: 1 }, proposal);
    expect(result.ok).toBe(true);
  });

  it('allows settlement below the threshold with no approval', () => {
    const decision = evaluateRefundProposal(baseInput({ amountMinor: 10_000 }));
    const result = assertPolicyAllowsSettlement(decision, null, proposal);
    expect(result.ok).toBe(true);
  });

  it('refuses settlement below the threshold if an approval was rejected', () => {
    const decision = evaluateRefundProposal(baseInput({ amountMinor: 10_000 }));
    const result = assertPolicyAllowsSettlement(decision, { status: 'REJECTED', proposalHash: 'hash-a', proposalRevision: 1 }, proposal);
    expect(result.ok).toBe(false);
  });
});
