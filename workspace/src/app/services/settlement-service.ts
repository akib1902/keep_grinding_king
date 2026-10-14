/**
 * Simulated settlement — PR-08, SRS-SETTLE-001..007, BUS-RULE-05/07.
 *
 * The whole point of this module is that replaying it is harmless:
 *
 *  * The operation id is derived from the reviewed proposal content
 *    (`deriveOperationId`), so a redelivered job computes the same id.
 *  * A unique constraint on `ledger_entries.operation_id` is the final guard: the
 *    second insert cannot succeed even under a race.
 *  * Every precondition is re-derived from the database at settlement time —
 *    policy re-evaluated, approval re-checked against the current proposal hash,
 *    refundable balance recomputed. A queue message is never treated as proof of
 *    authorization (SRS §4.3).
 *  * When an outcome is genuinely uncertain the operation is parked as UNKNOWN and
 *    the durable record is inspected before anything else is attempted
 *    (BUS-RULE-07) instead of blindly retrying a write.
 */
import { canonicalJson, newId, sha256 } from '../../domain/ids.js';
import { formatMoney } from '../../domain/money.js';
import { evaluateRefundProposal, assertPolicyAllowsSettlement, type PolicyConfig } from '../../domain/policy.js';
import { assertSettlementTransition } from '../../domain/state.js';
import { AppError, ErrorCode } from '../../domain/errors.js';
import { emitEvent, recordAudit, recordStep } from './telemetry.js';
import type { Clock, LedgerEntryRecord, LoggerPort, SettlementRecord, Store } from '../ports.js';

export interface SettlementServiceDeps {
  store: Store;
  clock: Clock;
  logger: LoggerPort;
  policy: PolicyConfig;
}

export type SettlementResult =
  | { status: 'SETTLED'; operationId: string; ledgerEntryId: string; amountMinor: number; currency: string; idempotentReplay: boolean }
  | { status: 'ALREADY_SETTLED'; operationId: string; ledgerEntryId: string; amountMinor: number; currency: string }
  | { status: 'REJECTED'; code: string; reason: string; operationId: string };

export class SettlementService {
  readonly #deps: SettlementServiceDeps;

  constructor(deps: SettlementServiceDeps) {
    this.#deps = deps;
  }

  /**
   * Settles an approved proposal exactly once.
   */
  async settle(input: { proposalId: string; operationId: string; attemptId?: string | null }): Promise<SettlementResult> {
    const { store, logger } = this.#deps;

    const proposal = await store.proposals.findById(input.proposalId);
    if (!proposal) {
      throw new AppError({
        code: ErrorCode.SETTLEMENT_PRECONDITION_FAILED,
        message: 'The proposal referenced by the settlement job does not exist.',
        category: 'POLICY',
        httpStatus: 422,
        retryable: false,
      });
    }

    // Fast path: already settled → return the durable outcome, write nothing.
    const existingOperation = await store.settlements.findByOperationId(input.operationId);
    if (existingOperation?.status === 'COMMITTED' && existingOperation.ledgerEntryId) {
      const existingEntry = await store.ledger.findById(existingOperation.ledgerEntryId);
      if (existingEntry) {
        logger.info({ operationId: input.operationId, proposalId: proposal.id }, 'settlement replay resolved to existing outcome');
        return {
          status: 'ALREADY_SETTLED',
          operationId: existingOperation.operationId,
          ledgerEntryId: existingEntry.id,
          amountMinor: existingEntry.amountMinor,
          currency: existingEntry.currency,
        };
      }
    }

    // A previous attempt left the outcome unknown: inspect the durable record
    // before attempting another write.
    if (existingOperation?.status === 'UNKNOWN') {
      const ledgerEntry = await store.ledger.findByOperationId(input.operationId);
      if (ledgerEntry) {
        await store.transaction(async (tx) => {
          await tx.settlements.transition({
            id: existingOperation.id,
            from: 'UNKNOWN',
            to: 'COMMITTED',
            ledgerEntryId: ledgerEntry.id,
          });
          await tx.proposals.transition({ id: proposal.id, from: proposal.status, to: 'SETTLED' });
          await emitEvent(tx, {
            runId: proposal.runId,
            eventType: 'settlement.reconciled',
            payload: { operationId: input.operationId, proposalId: proposal.id, ledgerEntryId: ledgerEntry.id },
          });
        });
        return {
          status: 'ALREADY_SETTLED',
          operationId: input.operationId,
          ledgerEntryId: ledgerEntry.id,
          amountMinor: ledgerEntry.amountMinor,
          currency: ledgerEntry.currency,
        };
      }
      // No ledger entry exists, so the earlier attempt did not commit: it is safe
      // to proceed with a fresh, bounded attempt.
      await store.settlements.transition({ id: existingOperation.id, from: 'UNKNOWN', to: 'FAILED', lastError: 'No durable ledger entry after unknown outcome.' });
    }

    // ---- Re-validate everything from authoritative state -------------------
    const transaction = await store.financial.findTransaction(proposal.tenantId, proposal.transactionId);
    const supplier = await store.financial.findSupplier(proposal.tenantId, proposal.supplierId);
    const refunds = await store.financial.sumRefundsForTransaction(proposal.tenantId, proposal.transactionId);
    const conflicting = await store.proposals.countConflicting(proposal.tenantId, proposal.transactionId, proposal.id);
    const approval = await store.approvals.findByProposalId(proposal.id);

    // `sumRefundsForTransaction` deliberately includes this proposal itself, so
    // subtract it when computing the balance available to THIS settlement.
    const otherRefundMinor = Math.max(0, refunds.settledMinor + refunds.activeMinor - proposal.amountMinor);
    const refundableAmountMinor = transaction ? Math.max(0, transaction.amountMinor - otherRefundMinor) : 0;

    const decision = evaluateRefundProposal(
      {
        amountMinor: proposal.amountMinor,
        currency: proposal.currency,
        transactionId: proposal.transactionId,
        supplierId: proposal.supplierId,
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
        existingRefundMinor: otherRefundMinor,
        hasConflictingActiveRefund: false,
      },
      this.#deps.policy,
    );

    const guard = assertPolicyAllowsSettlement(
      decision,
      approval ? { status: approval.status, proposalHash: approval.proposalHash, proposalRevision: approval.proposalRevision } : null,
      { reviewedHash: proposal.reviewedHash, revision: proposal.revision },
    );

    if (!guard.ok || proposal.status !== 'APPROVED') {
      const code = guard.ok ? 'PROPOSAL_NOT_APPROVED' : guard.code;
      const reason = guard.ok ? `Proposal status is ${proposal.status}.` : guard.reason;
      await recordStep(store, {
        runId: proposal.runId,
        attemptId: input.attemptId ?? null,
        stepType: 'SETTLEMENT',
        status: 'FAILED',
        summary: `Settlement refused: ${code}`,
        errorCode: code,
        errorMessage: reason,
        retryable: false,
      });
      await recordAudit(store, {
        tenantId: proposal.tenantId,
        runId: proposal.runId,
        actorType: 'SYSTEM',
        action: 'settlement.refused',
        targetType: 'refund_proposal',
        targetId: proposal.id,
        metadata: { code, reason, conflictingApprovals: conflicting },
      });
      return { status: 'REJECTED', code, reason, operationId: input.operationId };
    }

    const entryHash = sha256(
      canonicalJson({
        operationId: input.operationId,
        proposalId: proposal.id,
        proposalRevision: proposal.revision,
        supplierId: proposal.supplierId,
        amountMinor: proposal.amountMinor,
        currency: proposal.currency,
      }),
    );

    try {
      const result = await store.transaction(async (tx) => {
        // Ensure the operation row exists (PENDING) before the ledger write so a
        // crash mid-transaction leaves no half state: both writes commit together.
        let operation: SettlementRecord | null = await tx.settlements.findByOperationId(input.operationId);
        if (!operation) {
          operation = await tx.settlements.insert({
            id: newId(),
            operationId: input.operationId,
            tenantId: proposal.tenantId,
            runId: proposal.runId,
            proposalId: proposal.id,
            status: 'PENDING',
          });
        }
        await tx.settlements.incrementAttempts(operation.id);

        const ledgerEntry = await tx.ledger.insert({
          id: newId(),
          tenantId: proposal.tenantId,
          operationId: input.operationId,
          proposalId: proposal.id,
          supplierId: proposal.supplierId,
          amountMinor: proposal.amountMinor,
          currency: proposal.currency,
          memo: `Simulated refund for proposal ${proposal.id} (${formatMoney(proposal.amountMinor, proposal.currency)})`,
          entryHash,
        });

        assertSettlementTransition(operation.status, 'COMMITTED');
        const committed = await tx.settlements.transition({
          id: operation.id,
          from: operation.status,
          to: 'COMMITTED',
          ledgerEntryId: ledgerEntry.id,
        });
        if (!committed) throw new Error('Settlement operation could not be committed.');

        const settled = await tx.proposals.transition({ id: proposal.id, from: 'APPROVED', to: 'SETTLED' });
        if (!settled) throw new Error('Proposal could not be marked settled.');

        await recordStep(tx, {
          runId: proposal.runId,
          attemptId: input.attemptId ?? null,
          stepType: 'SETTLEMENT',
          status: 'SUCCEEDED',
          summary: `Simulated settlement committed: ${formatMoney(proposal.amountMinor, proposal.currency)}`,
          payload: {
            operationId: input.operationId,
            proposalId: proposal.id,
            ledgerEntryId: ledgerEntry.id,
            entryHash,
            approvalId: approval?.id ?? null,
            amountMinor: proposal.amountMinor,
            currency: proposal.currency,
          },
        });

        await emitEvent(tx, {
          runId: proposal.runId,
          eventType: 'settlement.committed',
          payload: {
            operationId: input.operationId,
            proposalId: proposal.id,
            ledgerEntryId: ledgerEntry.id,
            amountMinor: proposal.amountMinor,
            currency: proposal.currency,
          },
        });

        await recordAudit(tx, {
          tenantId: proposal.tenantId,
          runId: proposal.runId,
          actorType: 'SYSTEM',
          action: 'settlement.committed',
          targetType: 'ledger_entry',
          targetId: ledgerEntry.id,
          metadata: {
            operationId: input.operationId,
            proposalId: proposal.id,
            amountMinor: proposal.amountMinor,
            currency: proposal.currency,
            approvalId: approval?.id ?? null,
          },
        });

        return ledgerEntry;
      });

      logger.info(
        { operationId: input.operationId, proposalId: proposal.id, ledgerEntryId: result.id },
        'simulated settlement committed',
      );

      return {
        status: 'SETTLED',
        operationId: input.operationId,
        ledgerEntryId: result.id,
        amountMinor: result.amountMinor,
        currency: result.currency,
        idempotentReplay: existingOperation !== null,
      };
    } catch (error) {
      return this.#handleSettlementFailure(input.operationId, proposal.id, proposal.runId, error);
    }
  }

  /**
   * Distinguishes "the write definitely did not happen" from "we cannot tell".
   * Only the former is safe to retry without inspection.
   */
  async #handleSettlementFailure(operationId: string, proposalId: string, runId: string, error: unknown): Promise<SettlementResult> {
    const { store, logger } = this.#deps;
    const message = error instanceof Error ? error.message : 'Unknown settlement failure.';
    const uniqueViolation = isUniqueConstraintViolation(error);

    if (uniqueViolation) {
      // The ledger row exists — the duplicate insert was rejected. Resolve to the
      // existing logical outcome instead of creating a second entry.
      const existing = await store.ledger.findByOperationId(operationId);
      if (existing) {
        const operation = await store.settlements.findByOperationId(operationId);
        if (operation && operation.status !== 'COMMITTED') {
          await store.transaction(async (tx) => {
            await tx.settlements.transition({ id: operation.id, from: operation.status, to: 'COMMITTED', ledgerEntryId: existing.id });
            const proposal = await tx.proposals.findById(proposalId);
            if (proposal && proposal.status === 'APPROVED') {
              await tx.proposals.transition({ id: proposal.id, from: 'APPROVED', to: 'SETTLED' });
            }
          });
        }
        return {
          status: 'ALREADY_SETTLED',
          operationId,
          ledgerEntryId: existing.id,
          amountMinor: existing.amountMinor,
          currency: existing.currency,
        };
      }
      // A unique violation with no visible ledger row is an unresolvable
      // inconsistency: park the operation for inspection rather than retrying.
      await this.#markUnknown(operationId, runId, proposalId, message);
      throw new AppError({
        code: ErrorCode.SETTLEMENT_OUTCOME_UNKNOWN,
        message: 'Settlement outcome could not be determined; the durable record must be inspected before retrying.',
        category: 'TRANSIENT',
        httpStatus: 503,
        retryable: false,
        details: { operationId },
      });
    }

    const operation = await store.settlements.findByOperationId(operationId);
    if (operation) {
      await store.settlements.transition({ id: operation.id, from: operation.status, to: 'FAILED', lastError: message });
    }
    await recordAudit(store, {
      tenantId: (await store.proposals.findById(proposalId))?.tenantId ?? 'unknown',
      runId,
      actorType: 'SYSTEM',
      action: 'settlement.failed',
      targetType: 'refund_proposal',
      targetId: proposalId,
      metadata: { operationId, error: message },
    });
    logger.error({ operationId, proposalId, error: message }, 'settlement failed without committing');
    // A rolled-back transaction leaves no partial settlement, so a bounded retry
    // by the queue is safe here.
    throw new AppError({
      code: ErrorCode.SERVICE_UNAVAILABLE,
      message: 'Settlement transaction failed and was rolled back; a bounded retry is safe.',
      category: 'TRANSIENT',
      httpStatus: 503,
      retryable: true,
      cause: error,
    });
  }

  async #markUnknown(operationId: string, runId: string, proposalId: string, reason: string): Promise<void> {
    const { store } = this.#deps;
    const operation = await store.settlements.findByOperationId(operationId);
    if (operation && operation.status !== 'UNKNOWN' && operation.status !== 'COMMITTED') {
      await store.settlements.transition({ id: operation.id, from: operation.status, to: 'UNKNOWN', lastError: reason });
      await emitEvent(store, {
        runId,
        eventType: 'settlement.unknown',
        payload: { operationId, proposalId, reason },
      });
    }
  }

  async getOperation(operationId: string, tenantId: string): Promise<{ operation: SettlementRecord; ledgerEntry: LedgerEntryRecord | null } | null> {
    const operation = await this.#deps.store.settlements.findByOperationId(operationId);
    if (!operation || operation.tenantId !== tenantId) return null;
    const ledgerEntry = operation.ledgerEntryId ? await this.#deps.store.ledger.findById(operation.ledgerEntryId) : null;
    return { operation, ledgerEntry };
  }
}

function isUniqueConstraintViolation(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const code = (error as { code?: unknown }).code;
  // Prisma surfaces PostgreSQL unique violations as P2002.
  return code === 'P2002';
}
