/**
 * Human approval workflow — PR-07, SRS-APPROVAL-001..007.
 *
 * The controls that make this safe rather than decorative:
 *  * Authorization is checked here as well as at the edge, independently of the
 *    run's owner (SRS-AUTH-003).
 *  * The decision is bound to the proposal revision AND content hash that were
 *    reviewed, so a proposal edited after review cannot be settled by a stale
 *    approval (BUS-RULE-08, SRS-POLICY-009).
 *  * A separate person decides: the requester may not approve their own run
 *    (BUS-RULE-03 separation of duties, enforced for the human path too).
 *  * The decision and the durable resumption command are written in the same
 *    transaction, so an approval can never be recorded without a resume being
 *    arranged (SRS-APPROVAL-007).
 */
import { newId } from '../../domain/ids.js';
import { AppError, ErrorCode, conflict, forbidden, notFound, unprocessable } from '../../domain/errors.js';
import { assertProposalTransition } from '../../domain/state.js';
import { emitEvent, recordAudit, recordStep } from './telemetry.js';
import type { Clock, LoggerPort, RefundProposalRecord, RunRecord, Store } from '../ports.js';
import type { PolicyConfig } from '../../domain/policy.js';

export interface ApprovalServiceDeps {
  store: Store;
  clock: Clock;
  logger: LoggerPort;
  policy: PolicyConfig;
}

export interface ApprovalContext {
  userId: string;
  tenantId: string;
  role: 'ANALYST' | 'APPROVER' | 'ADMIN';
}

export class ApprovalService {
  readonly #deps: ApprovalServiceDeps;

  constructor(deps: ApprovalServiceDeps) {
    this.#deps = deps;
  }

  /** Creates the approval request for a proposal that exceeds the threshold. */
  async create(input: {
    run: RunRecord;
    proposal: RefundProposalRecord;
    expiresAt: Date;
    reviewedSnapshot: Record<string, unknown>;
  }) {
    const { store } = this.#deps;
    const approval = await store.approvals.insert({
      id: newId(),
      tenantId: input.run.tenantId,
      runId: input.run.id,
      proposalId: input.proposal.id,
      proposalRevision: input.proposal.revision,
      proposalHash: input.proposal.reviewedHash,
      reviewedSnapshot: input.reviewedSnapshot,
      expiresAt: input.expiresAt,
    });

    await recordStep(store, {
      runId: input.run.id,
      attemptId: input.run.attemptId,
      stepType: 'APPROVAL_REQUIRED',
      status: 'SUCCEEDED',
      summary: `Human approval required for proposal ${input.proposal.id}`,
      payload: {
        approvalId: approval.id,
        proposalId: input.proposal.id,
        proposalRevision: approval.proposalRevision,
        expiresAt: approval.expiresAt.toISOString(),
      },
    });

    await emitEvent(store, {
      runId: input.run.id,
      eventType: 'approval.required',
      payload: {
        approvalId: approval.id,
        proposalId: input.proposal.id,
        proposalRevision: approval.proposalRevision,
        amountMinor: input.proposal.amountMinor,
        currency: input.proposal.currency,
        expiresAt: approval.expiresAt.toISOString(),
      },
    });

    await recordAudit(store, {
      tenantId: input.run.tenantId,
      runId: input.run.id,
      actorType: 'SYSTEM',
      action: 'approval.requested',
      targetType: 'approval_request',
      targetId: approval.id,
      metadata: { proposalId: input.proposal.id, expiresAt: approval.expiresAt.toISOString() },
    });

    return approval;
  }

  async get(id: string, context: ApprovalContext) {
    const approval = await this.#deps.store.approvals.findByIdForTenant(id, context.tenantId);
    if (!approval) throw notFound('Approval request not found.');
    if (context.role === 'ANALYST') {
      const run = await this.#deps.store.runs.findById(approval.runId);
      // An analyst may only see approvals for their own runs.
      if (!run || run.ownerId !== context.userId) throw notFound('Approval request not found.');
    }
    return approval;
  }

  /**
   * Records an authorized approve/reject decision.
   *
   * `apply` is the caller's callback that runs inside the decision transaction,
   * used to continue the workflow (for example to settle an approved proposal).
   */
  async decide(input: {
    approvalId: string;
    decision: 'APPROVE' | 'REJECT';
    reason: string | null;
    context: ApprovalContext;
  }): Promise<{ approvalId: string; status: 'APPROVED' | 'REJECTED'; proposalId: string; runId: string }> {
    const { store, clock, logger } = this.#deps;
    const now = clock.now();

    const existing = await store.approvals.findByIdForTenant(input.approvalId, input.context.tenantId);
    if (!existing) throw notFound('Approval request not found.');

    if (input.context.role !== 'APPROVER' && input.context.role !== 'ADMIN') {
      throw forbidden('The caller does not hold the approval permission.');
    }

    const proposal = await store.proposals.findById(existing.proposalId);
    if (!proposal) throw notFound('The proposal behind this approval request no longer exists.');
    const run = await store.runs.findById(existing.runId);
    if (!run) throw notFound('The run behind this approval request no longer exists.');

    // Separation of duties: the person who requested the research cannot approve
    // the refund it produced.
    if (run.ownerId === input.context.userId) {
      throw new AppError({
        code: ErrorCode.SEPARATION_OF_DUTIES,
        message: 'The requester of a run cannot approve its refund proposal.',
        category: 'AUTHORIZATION',
        httpStatus: 403,
        retryable: false,
      });
    }

    if (existing.status !== 'PENDING') {
      throw conflict(
        ErrorCode.APPROVAL_NOT_PENDING,
        `This approval request is already ${existing.status} and cannot be decided again.`,
        { status: existing.status },
      );
    }

    if (existing.expiresAt.getTime() <= now.getTime()) {
      const expired = await store.approvals.expire(existing.id, now);
      if (expired) {
        await recordAudit(store, {
          tenantId: existing.tenantId,
          runId: existing.runId,
          actorType: 'SYSTEM',
          action: 'approval.expired',
          targetType: 'approval_request',
          targetId: existing.id,
          metadata: { proposalId: existing.proposalId },
        });
      }
      throw new AppError({
        code: ErrorCode.APPROVAL_EXPIRED,
        message: 'This approval request has expired and can no longer be decided.',
        category: 'POLICY',
        httpStatus: 422,
        retryable: false,
        details: { expiresAt: existing.expiresAt.toISOString() },
      });
    }

    // The decision applies to exactly the revision that was reviewed.
    if (proposal.revision !== existing.proposalRevision || proposal.reviewedHash !== existing.proposalHash) {
      throw new AppError({
        code: ErrorCode.APPROVAL_HASH_MISMATCH,
        message: 'The proposal changed after it was reviewed; this approval is stale.',
        category: 'CONFLICT',
        httpStatus: 409,
        retryable: false,
        details: { reviewedRevision: existing.proposalRevision, currentRevision: proposal.revision },
      });
    }

    const target = input.decision === 'APPROVE' ? 'APPROVED' : 'REJECTED';
    assertProposalTransition(proposal.status, target);
    if (proposal.status !== 'REQUIRES_APPROVAL') {
      throw unprocessable(ErrorCode.APPROVAL_NOT_PENDING, `Proposal is ${proposal.status} and cannot be decided.`);
    }

    const decided = await store.transaction(async (tx) => {
      const updated = await tx.approvals.decide({
        id: existing.id,
        to: target,
        decidedById: input.context.userId,
        decidedAt: now,
        reason: input.reason,
      });
      // A null result means another writer decided first: the conditional update
      // guarantees exactly one final outcome (SRS-APPROVAL-004).
      if (!updated) {
        throw conflict(ErrorCode.CONCURRENT_MODIFICATION, 'The approval request was decided by another request.', {
          approvalId: existing.id,
        });
      }

      const transitionedProposal = await tx.proposals.transition({
        id: proposal.id,
        from: 'REQUIRES_APPROVAL',
        to: target,
        expectedRevision: proposal.revision,
      });
      if (!transitionedProposal) {
        throw conflict(ErrorCode.CONCURRENT_MODIFICATION, 'The proposal changed while the decision was recorded.');
      }

      await recordStep(tx, {
        runId: existing.runId,
        attemptId: run.attemptId,
        stepType: 'APPROVAL_DECIDED',
        status: 'SUCCEEDED',
        summary: `Approval ${target.toLowerCase()} by user ${input.context.userId}`,
        payload: {
          approvalId: existing.id,
          proposalId: proposal.id,
          decision: target,
          proposalRevision: existing.proposalRevision,
          reason: input.reason,
        },
      });

      await emitEvent(tx, {
        runId: existing.runId,
        eventType: 'approval.decided',
        payload: {
          approvalId: existing.id,
          proposalId: proposal.id,
          decision: target,
          decidedAt: now.toISOString(),
          reason: input.reason,
        },
      });

      await recordAudit(tx, {
        tenantId: existing.tenantId,
        runId: existing.runId,
        actorType: 'USER',
        actorId: input.context.userId,
        action: `approval.${target.toLowerCase()}`,
        targetType: 'approval_request',
        targetId: existing.id,
        metadata: { proposalId: proposal.id, amountMinor: proposal.amountMinor, currency: proposal.currency, reason: input.reason },
      });

      // Durable resumption command, written in the same transaction as the
      // decision. The queue is never the record of truth.
      await tx.outbox.enqueue({
        topic: 'run.resume',
        dedupeKey: `resume:proposal:${proposal.id}:${target.toLowerCase()}`,
        payload: {
          version: 1,
          runId: existing.runId,
          proposalId: proposal.id,
          approvalId: existing.id,
          decision: target,
        },
      });

      return updated;
    });

    logger.info(
      { approvalId: decided.id, runId: existing.runId, proposalId: proposal.id, decision: target },
      'approval decision recorded',
    );

    return { approvalId: decided.id, status: target, proposalId: proposal.id, runId: existing.runId };
  }

  /** Marks a pending request as expired and records the outcome. */
  async expire(approvalId: string, now: Date): Promise<boolean> {
    const { store } = this.#deps;
    return store.transaction(async (tx) => {
      const approval = await tx.approvals.findById(approvalId);
      if (!approval || approval.status !== 'PENDING') return false;
      const expired = await tx.approvals.expire(approval.id, now);
      if (!expired) return false;
      await tx.proposals.transition({ id: approval.proposalId, from: 'REQUIRES_APPROVAL', to: 'EXPIRED' });
      await emitEvent(tx, {
        runId: approval.runId,
        eventType: 'approval.expired',
        payload: { approvalId: approval.id, proposalId: approval.proposalId, expiresAt: approval.expiresAt.toISOString() },
      });
      await recordAudit(tx, {
        tenantId: approval.tenantId,
        runId: approval.runId,
        actorType: 'SYSTEM',
        action: 'approval.expired',
        targetType: 'approval_request',
        targetId: approval.id,
        metadata: { proposalId: approval.proposalId },
      });
      return true;
    });
  }
}
