/**
 * Deterministic financial policy engine — PR-06, SRS-POLICY-004..009.
 *
 * Properties that matter more than the rules themselves:
 *
 *  1. Purity. Same input + same policy version ⇒ identical decision, byte for
 *     byte. No clock, no randomness, no I/O. That is what allows the decision to
 *     be replayed and verified in tests and in an audit.
 *  2. Isolation. The engine only ever sees facts that the application layer
 *     resolved from the database. It never sees a model-supplied tenant, user,
 *     balance or "already approved" flag (SRS-AUTH-004), so a model response
 *     cannot talk its way past a rule (SRS-POLICY-007).
 *  3. Explainability. Every rule result is recorded, so a human reviewer can see
 *     exactly which rule produced the outcome.
 */
import { z } from 'zod';
import { canonicalJson, sha256 } from './ids.js';
import { AmountMinorSchema, CurrencySchema, SUPPORTED_CURRENCIES, formatMoney, type SupportedCurrency } from './money.js';

export interface PolicyConfig {
  /** Version recorded on every proposal; bump when rules change. */
  readonly version: string;
  /** Amounts strictly greater than this require human approval (BUS-RULE-01). */
  readonly approvalThresholdMinor: number;
  readonly currency: SupportedCurrency;
  /** Hard ceiling for a single refund, independent of the transaction amount. */
  readonly maxRefundMinor: number;
  /** Whether a partially-refunded transaction may still receive a refund. */
  readonly allowPartialRefund: boolean;
}

/**
 * Policy v1 — frozen. Amounts are integer minor units.
 * USD 500.00 approval threshold, USD 10,000.00 hard per-refund ceiling.
 */
export const POLICY_V1: PolicyConfig = Object.freeze({
  version: 'v1',
  approvalThresholdMinor: 50_000,
  currency: 'USD',
  maxRefundMinor: 1_000_000,
  allowPartialRefund: true,
});

export const POLICY_REGISTRY: Readonly<Record<string, PolicyConfig>> = Object.freeze({
  v1: POLICY_V1,
});

export function resolvePolicy(version: string, overrides?: { approvalThresholdMinor?: number; currency?: string }): PolicyConfig {
  const base = POLICY_REGISTRY[version];
  if (!base) throw new Error(`Unknown policy version "${version}".`);
  if (!overrides) return base;
  const currency = overrides.currency ? CurrencySchema.parse(overrides.currency) : base.currency;
  const threshold = overrides.approvalThresholdMinor ?? base.approvalThresholdMinor;
  return Object.freeze({ ...base, currency, approvalThresholdMinor: threshold });
}

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

/** Facts about the source transaction, resolved by the application layer. */
export interface PolicyTransactionFact {
  id: string;
  supplierId: string;
  amountMinor: number;
  currency: string;
  /** POSTED | REFUNDED | DISPUTED */
  status: string;
  occurredAt: string;
}

export interface PolicySupplierFact {
  id: string;
  active: boolean;
}

export interface PolicyReviewInput {
  /** Proposed refund amount — from the agent, re-validated here regardless. */
  amountMinor: number;
  currency: string;
  transactionId: string;
  supplierId: string;
  transaction: PolicyTransactionFact | null;
  supplier: PolicySupplierFact | null;
  /** Amount that may still be refunded for the source transaction. */
  refundableAmountMinor: number;
  /** Existing refunds already proposed/settled against the same transaction. */
  existingRefundMinor: number;
  hasConflictingActiveRefund: boolean;
}

export type PolicyOutcome = 'ALLOW' | 'REQUIRES_APPROVAL' | 'DENY';

export interface PolicyCheck {
  ruleId: string;
  description: string;
  passed: boolean;
  detail?: string;
}

export interface PolicyDecision {
  policyVersion: string;
  /**
   * The exact facts this decision was evaluated against. Recorded so the decision
   * hash distinguishes two amounts (or two suppliers) that happen to reach the
   * same outcome — otherwise the hash would be weak audit evidence.
   */
  subject: {
    amountMinor: number;
    currency: string;
    transactionId: string;
    supplierId: string;
    refundableAmountMinor: number;
    existingRefundMinor: number;
  };
  outcome: PolicyOutcome;
  requiresApproval: boolean;
  /** Populated when outcome is DENY. */
  denyReasons: string[];
  checks: PolicyCheck[];
  /** Deterministic hash over the policy version, evaluated facts and rule results. */
  decisionHash: string;
}

export const RuleId = {
  AMOUNT_VALID: 'POL-001',
  CURRENCY_SUPPORTED: 'POL-002',
  TRANSACTION_EXISTS: 'POL-003',
  SUPPLIER_VALID: 'POL-004',
  WITHIN_REFUNDABLE: 'POL-005',
  NO_CONFLICTING_REFUND: 'POL-006',
  MAX_REFUND_CEILING: 'POL-007',
  APPROVAL_THRESHOLD: 'POL-008',
} as const;

// ---------------------------------------------------------------------------
// Evaluation
// ---------------------------------------------------------------------------

/**
 * Evaluates a proposed refund. Returns a DENY when any structural rule fails,
 * otherwise REQUIRES_APPROVAL above the threshold and ALLOW at or below it.
 */
export function evaluateRefundProposal(input: PolicyReviewInput, config: PolicyConfig = POLICY_V1): PolicyDecision {
  const checks: PolicyCheck[] = [];

  const amountValid = Number.isInteger(input.amountMinor) && AmountMinorSchema.safeParse(input.amountMinor).success;
  checks.push({
    ruleId: RuleId.AMOUNT_VALID,
    description: 'Refund amount is a positive integer number of minor units.',
    passed: amountValid,
    ...(amountValid ? {} : { detail: `Received ${String(input.amountMinor)}.` }),
  });

  const currencyValid = CurrencySchema.safeParse(input.currency).success && input.currency === config.currency;
  checks.push({
    ruleId: RuleId.CURRENCY_SUPPORTED,
    description: `Currency is supported and matches the policy currency (${config.currency}).`,
    passed: currencyValid,
    ...(currencyValid ? {} : { detail: `Received "${input.currency}".` }),
  });

  const transactionExists = input.transaction !== null && input.transaction.id === input.transactionId;
  checks.push({
    ruleId: RuleId.TRANSACTION_EXISTS,
    description: 'Source transaction exists within the caller\'s authorised scope.',
    passed: transactionExists,
    ...(transactionExists ? {} : { detail: `Transaction ${input.transactionId} was not found or is not authorisable.` }),
  });

  const supplierValid =
    input.supplier !== null &&
    input.supplier.active &&
    transactionExists &&
    input.transaction?.supplierId === input.supplierId &&
    input.supplier.id === input.supplierId;
  checks.push({
    ruleId: RuleId.SUPPLIER_VALID,
    description: 'Supplier exists, is active and owns the source transaction.',
    passed: supplierValid,
    ...(supplierValid ? {} : { detail: `Supplier ${input.supplierId} is unknown, inactive or unrelated to the transaction.` }),
  });

  const withinRefundable = amountValid && input.amountMinor <= input.refundableAmountMinor;
  checks.push({
    ruleId: RuleId.WITHIN_REFUNDABLE,
    description: 'Refund does not exceed the refundable balance of the source transaction.',
    passed: withinRefundable,
    ...(withinRefundable
      ? {}
      : {
          detail: `${formatMoney(input.amountMinor, config.currency)} requested; refundable ${formatMoney(
            input.refundableAmountMinor,
            config.currency,
          )}.`,
        }),
  });

  const noConflict = !input.hasConflictingActiveRefund;
  checks.push({
    ruleId: RuleId.NO_CONFLICTING_REFUND,
    description: 'No other refund is already awaiting approval or settled for this transaction.',
    passed: noConflict,
    ...(noConflict ? {} : { detail: 'A conflicting refund already exists for the source transaction.' }),
  });

  const withinCeiling = amountValid && input.amountMinor <= config.maxRefundMinor;
  checks.push({
    ruleId: RuleId.MAX_REFUND_CEILING,
    description: `Refund is within the policy ceiling of ${formatMoney(config.maxRefundMinor, config.currency)}.`,
    passed: withinCeiling,
    ...(withinCeiling ? {} : { detail: 'Refund exceeds the policy ceiling.' }),
  });

  // Boundary rule: strictly greater than the threshold requires approval.
  const requiresApprovalByThreshold = amountValid && input.amountMinor > config.approvalThresholdMinor;
  checks.push({
    ruleId: RuleId.APPROVAL_THRESHOLD,
    description: `Refund at or below ${formatMoney(config.approvalThresholdMinor, config.currency)} is auto-allowed; above it requires human approval.`,
    passed: !requiresApprovalByThreshold,
    detail: requiresApprovalByThreshold
      ? `Exceeds the approval threshold by ${formatMoney(input.amountMinor - config.approvalThresholdMinor, config.currency)}.`
      : 'At or below the approval threshold.',
  });

  const denyReasons = checks
    .filter((check) => !check.passed && check.ruleId !== RuleId.APPROVAL_THRESHOLD)
    .map((check) => check.ruleId);

  const outcome: PolicyOutcome = denyReasons.length > 0 ? 'DENY' : requiresApprovalByThreshold ? 'REQUIRES_APPROVAL' : 'ALLOW';

  const decision: Omit<PolicyDecision, 'decisionHash'> = {
    policyVersion: config.version,
    subject: {
      amountMinor: input.amountMinor,
      currency: input.currency,
      transactionId: input.transactionId,
      supplierId: input.supplierId,
      refundableAmountMinor: input.refundableAmountMinor,
      existingRefundMinor: input.existingRefundMinor,
    },
    outcome,
    requiresApproval: outcome === 'REQUIRES_APPROVAL',
    denyReasons,
    checks,
  };

  return { ...decision, decisionHash: sha256(canonicalJson(decision)) };
}

/**
 * Re-validation immediately before settlement (SRS-POLICY-008).
 * A settlement is only permitted when the *current* facts still allow it.
 */
export function assertPolicyAllowsSettlement(
  decision: PolicyDecision,
  approval: { status: string; proposalHash: string; proposalRevision: number } | null,
  proposal: { reviewedHash: string; revision: number },
): { ok: true } | { ok: false; code: string; reason: string } {
  if (decision.outcome === 'DENY') {
    return { ok: false, code: 'POLICY_DENIED', reason: `Policy ${decision.policyVersion} denied: ${decision.denyReasons.join(', ')}.` };
  }
  if (decision.outcome === 'REQUIRES_APPROVAL') {
    if (!approval) return { ok: false, code: 'APPROVAL_REQUIRED', reason: 'This refund requires human approval and none exists.' };
    if (approval.status !== 'APPROVED') {
      return { ok: false, code: 'APPROVAL_NOT_APPROVED', reason: `Approval request is ${approval.status}.` };
    }
    // Approval must reference exactly what was reviewed (BUS-RULE-08, SRS-POLICY-009).
    if (approval.proposalHash !== proposal.reviewedHash || approval.proposalRevision !== proposal.revision) {
      return {
        ok: false,
        code: 'APPROVAL_HASH_MISMATCH',
        reason: 'The proposal changed after it was reviewed; the approval is stale.',
      };
    }
  } else {
    // Auto-allowed: no approval needed, but a rejected/expired approval must not
    // coexist with a settlement (SRS-STATE-007).
    if (approval && approval.status !== 'APPROVED') {
      return { ok: false, code: 'APPROVAL_NOT_APPROVED', reason: `Approval request is ${approval.status}.` };
    }
  }
  return { ok: true };
}

export const SupportedCurrencies = SUPPORTED_CURRENCIES;

export const PolicyReviewInputSchema = z.object({
  amountMinor: AmountMinorSchema,
  currency: CurrencySchema,
  transactionId: z.string().min(1),
  supplierId: z.string().min(1),
});
