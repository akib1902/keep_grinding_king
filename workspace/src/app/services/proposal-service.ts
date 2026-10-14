/**
 * Refund proposal service — the restricted write path the agent is allowed to use.
 *
 * PR-05 and SRS-POLICY-001..007 in one place:
 *  * Every fact the policy engine sees is resolved here from the database, using
 *    the run's tenant scope. Not one of them comes from the model.
 *  * The proposed amount is additionally capped by the deterministic finding's
 *    suggested refund, so the model cannot inflate a claim.
 *  * A proposal never moves funds. Above the threshold it pauses the workflow.
 */
import { canonicalJson, newId, sha256 } from '../../domain/ids.js';
import { formatMoney } from '../../domain/money.js';
import { evaluateRefundProposal, type PolicyDecision } from '../../domain/policy.js';
import type { PolicyConfig } from '../../domain/policy.js';
import { recordAudit, recordStep, emitEvent } from './telemetry.js';
import type { Clock, LoggerPort, ProposalStore, RunRecord, Store } from '../ports.js';
import type { ProposalCreationOutcome } from '../agent/types.js';
import { ApprovalService } from './approval-service.js';

export interface CreateProposalInput {
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
}

export interface ProposalServiceDeps {
  store: Store;
  clock: Clock;
  logger: LoggerPort;
  policy: PolicyConfig;
  approvalTtlSeconds: number;
}

export class ProposalService {
  readonly #deps: ProposalServiceDeps;
  readonly #approvals: ApprovalService;

  constructor(deps: ProposalServiceDeps) {
    this.#deps = deps;
    this.#approvals = new ApprovalService({
      store: deps.store,
      clock: deps.clock,
      logger: deps.logger,
      policy: deps.policy,
    });
  }

  /**
   * Creates a proposal, records the policy evaluation and, when the policy
   * requires it, an approval request — all in one transaction.
   */
  async create(input: CreateProposalInput): Promise<ProposalCreationOutcome> {
    const { store, clock, policy, logger } = this.#deps;
    const { run } = input;

    const transaction = await store.financial.findTransaction(run.tenantId, input.transactionId);
    const supplier = await store.financial.findSupplier(run.tenantId, input.supplierId);

    const refunds = transaction
      ? await store.financial.sumRefundsForTransaction(run.tenantId, transaction.id)
      : { activeMinor: 0, settledMinor: 0 };
    const conflicting = transaction
      ? await store.proposals.countConflicting(run.tenantId, transaction.id, null)
      : 0;

    const refundableAmountMinor = transaction ? Math.max(0, transaction.amountMinor - refunds.settledMinor - refunds.activeMinor) : 0;

    const decision: PolicyDecision = evaluateRefundProposal(
      {
        amountMinor: input.amountMinor,
        currency: input.currency,
        transactionId: input.transactionId,
        supplierId: input.supplierId,
        transaction: transaction
          ? {
              id: transaction.id,
              supplierId: transaction.supplierId,
              amountMinor: transaction.amountMinor,
              currency: transaction.currency,
              status: transaction.status,
              occurredAt: transaction.occurredAt.toISOString(),
            }
          : null,
        supplier: supplier ? { id: supplier.id, active: supplier.active } : null,
        refundableAmountMinor,
        existingRefundMinor: refunds.activeMinor + refunds.settledMinor,
        hasConflictingActiveRefund: conflicting > 0,
      },
      policy,
    );

    // Rule-grounded cap: the model may not exceed the arithmetic overcharge the
    // deterministic rule computed for the finding it cites.
    const exceedsFindingBasis = input.amountMinor > input.findingSuggestedRefundMinor || !input.findingRefundEligible;

    const now = clock.now();
    const reviewedHash = computeReviewedHash({
      transactionId: input.transactionId,
      supplierId: input.supplierId,
      amountMinor: input.amountMinor,
      currency: input.currency,
      refundableAmountMinor,
      justification: input.justification,
      evidence: input.evidence,
      policyVersion: decision.policyVersion,
      revision: 1,
    });

    const status = decision.outcome === 'DENY' || exceedsFindingBasis ? 'POLICY_DENIED' : decision.requiresApproval ? 'REQUIRES_APPROVAL' : 'APPROVED';

    await recordStep(store, {
      runId: run.id,
      attemptId: input.attemptId,
      stepType: 'POLICY_EVALUATION',
      status: decision.outcome === 'DENY' || exceedsFindingBasis ? 'FAILED' : 'SUCCEEDED',
      summary: `Policy ${decision.policyVersion} → ${status}`,
      payload: {
        policyVersion: decision.policyVersion,
        outcome: decision.outcome,
        denyReasons: decision.denyReasons,
        exceededFindingBasis: exceedsFindingBasis,
        amountMinor: input.amountMinor,
        checkCount: decision.checks.length,
      },
    });

    if (status === 'POLICY_DENIED') {
      const denyReasons = exceedsFindingBasis
        ? [...decision.denyReasons, 'EXCEEDS_FINDING_BASIS']
        : decision.denyReasons;
      await recordAudit(store, {
        tenantId: run.tenantId,
        runId: run.id,
        actorType: 'AGENT',
        actorId: `agent:${input.attemptId}`,
        action: 'refund_proposal.denied_by_policy',
        targetType: 'finding',
        targetId: input.findingId,
        metadata: { denyReasons, amountMinor: input.amountMinor, policyVersion: decision.policyVersion },
      });
      await emitEvent(store, {
        runId: run.id,
        eventType: 'policy.denied',
        payload: {
          findingId: input.findingId,
          amountMinor: input.amountMinor,
          currency: input.currency,
          denyReasons,
          policyVersion: decision.policyVersion,
        },
      });
      return {
        proposalId: null,
        supplierId: input.supplierId,
        status,
        policyOutcome: 'DENY',
        policyVersion: decision.policyVersion,
        requiresApproval: false,
        denyReasons,
        amountMinor: input.amountMinor,
        currency: input.currency,
        approvalId: null,
      };
    }

    // The transaction must exist to persist a proposal (FK). A DENY for an unknown
    // transaction is reported without a row rather than fabricating one.
    if (!transaction) {
      throw new Error(`Transaction ${input.transactionId} does not exist in this tenant scope.`);
    }

    const proposal = await store.proposals.insert({
      id: newId(),
      tenantId: run.tenantId,
      runId: run.id,
      supplierId: input.supplierId,
      transactionId: transaction.id,
      amountMinor: input.amountMinor,
      currency: input.currency,
      refundableAmountMinor,
      justification: input.justification,
      evidence: input.evidence,
      status,
      reviewedHash,
      revision: 1,
      policyVersion: decision.policyVersion,
      policyDecision: decision,
      requiresApproval: decision.requiresApproval,
    });

    await recordStep(store, {
      runId: run.id,
      attemptId: input.attemptId,
      stepType: 'PROPOSAL_CREATED',
      status: 'SUCCEEDED',
      summary: `Refund proposal ${formatMoney(input.amountMinor, input.currency)} for supplier ${supplier?.name ?? input.supplierId}`,
      payload: {
        proposalId: proposal.id,
        amountMinor: proposal.amountMinor,
        currency: proposal.currency,
        status: proposal.status,
        reviewedHash,
        findingId: input.findingId,
      },
    });

    await recordAudit(store, {
      tenantId: run.tenantId,
      runId: run.id,
      actorType: 'AGENT',
      actorId: `agent:${input.attemptId}`,
      action: 'refund_proposal.created',
      targetType: 'refund_proposal',
      targetId: proposal.id,
      metadata: { amountMinor: proposal.amountMinor, currency: proposal.currency, status: proposal.status, policyVersion: decision.policyVersion },
    });

    await emitEvent(store, {
      runId: run.id,
      eventType: 'proposal.created',
      payload: {
        proposalId: proposal.id,
        amountMinor: proposal.amountMinor,
        currency: proposal.currency,
        status: proposal.status,
        requiresApproval: proposal.requiresApproval,
        policyVersion: decision.policyVersion,
      },
    });

    let approvalId: string | null = null;
    if (decision.requiresApproval) {
      const expiresAt = new Date(now.getTime() + this.#deps.approvalTtlSeconds * 1000);
      const approval = await this.#approvals.create({
        run,
        proposal,
        expiresAt,
        reviewedSnapshot: {
          proposalId: proposal.id,
          revision: proposal.revision,
          reviewedHash: proposal.reviewedHash,
          supplierId: proposal.supplierId,
          supplierName: supplier?.name ?? null,
          transactionId: proposal.transactionId,
          amountMinor: proposal.amountMinor,
          currency: proposal.currency,
          refundableAmountMinor: proposal.refundableAmountMinor,
          justification: proposal.justification,
          policyVersion: proposal.policyVersion,
          policyOutcome: decision.outcome,
          evidence: proposal.evidence,
        },
      });
      approvalId = approval.id;
      logger.info(
        { runId: run.id, proposalId: proposal.id, approvalId: approval.id, expiresAt: expiresAt.toISOString() },
        'approval required for refund proposal',
      );
    }

    return {
      proposalId: proposal.id,
      supplierId: proposal.supplierId,
      status: proposal.status,
      policyOutcome: decision.outcome,
      policyVersion: decision.policyVersion,
      requiresApproval: decision.requiresApproval,
      denyReasons: decision.denyReasons,
      amountMinor: proposal.amountMinor,
      currency: proposal.currency,
      approvalId,
    };
  }

  async listByRun(runId: string, store: ProposalStore = this.#deps.store.proposals) {
    return store.listByRun(runId);
  }
}

export function computeReviewedHash(input: {
  transactionId: string;
  supplierId: string;
  amountMinor: number;
  currency: string;
  refundableAmountMinor: number;
  justification: string;
  evidence: Record<string, unknown>;
  policyVersion: string;
  revision: number;
}): string {
  return sha256(canonicalJson(input));
}
