/**
 * Prisma implementation of the `Store` port.
 *
 * Notable implementation choices, all of them deliberate:
 *  * `transaction()` reuses the ambient transaction when called from inside one,
 *    so nested service calls compose into a single atomic unit instead of opening
 *    a second connection and deadlocking against the first.
 *  * Status transitions are compare-and-set updates (`updateMany` filtered by the
 *    expected `version`), then read back. A `null` result means "someone else won"
 *    — which is how concurrent transitions are rejected deterministically.
 *  * Step and event sequences are appended with a retry on unique-violation, so
 *    two workers recording concurrently cannot create a gap or a duplicate.
 *  * Outbox claiming uses `FOR UPDATE SKIP LOCKED`, so multiple dispatcher
 *    processes can never publish the same message twice.
 */
import prismaPkg from '@prisma/client';
import type { Prisma as PrismaNs, PrismaClient as PrismaClientType } from '@prisma/client';

import type { PolicyDecision } from '../../domain/policy.js';
import type { ApprovalStatus, ProposalStatus, RunStatus, SettlementStatus } from '../../domain/state.js';
import type {
  ApprovalStore,
  AuditInput,
  AuditRecord,
  AuditStore,
  EventStore,
  FinancialStore,
  IdempotencyStore,
  LedgerStore,
  OutboxStore,
  ProposalStore,
  RunStore,
  SettlementStore,
  StepStore,
  Store,
  TokenUsage,
  TransactionQuery,
  UserStore,
} from '../../app/ports.js';
import {
  mapApproval,
  mapAudit,
  mapEvent,
  mapIdempotency,
  mapLedgerEntry,
  mapOutbox,
  mapProposal,
  mapRun,
  mapSettlement,
  mapStep,
  mapSupplier,
  mapTransaction,
  mapUser,
} from './mappers.js';

const { Prisma, PrismaClient } = prismaPkg;

type Db = PrismaNs.TransactionClient;

class UniqueViolation extends Error {}
class NotFoundError extends Error {}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: string }).code === 'P2002';
}

export class PrismaStore implements Store {
  readonly #db: Db;
  readonly #root: PrismaClientType | null;

  constructor(db: Db, root: PrismaClientType | null = null) {
    this.#db = db;
    this.#root = root;
  }

  static create(): PrismaStore {
    const client = new PrismaClient();
    return new PrismaStore(client, client);
  }

  async transaction<T>(fn: (tx: Store) => Promise<T>): Promise<T> {
    if (this.#root === null) {
      // Already inside a transaction: stay in it (savepoint semantics are not
      // needed, atomicity already holds).
      return fn(this);
    }
    return this.#root.$transaction(async (tx) => fn(new PrismaStore(tx, null)), {
      maxWait: 10_000,
      timeout: 20_000,
    });
  }

  async disconnect(): Promise<void> {
    if (this.#root) await this.#root.$disconnect();
  }

  /** Liveness probe for the database dependency (SRS-OBS-002). */
  async ping(): Promise<void> {
    await this.#db.$queryRaw`SELECT 1`;
  }

  // ---------------------------------------------------------------------------
  // Runs
  // ---------------------------------------------------------------------------

  get runs(): RunStore {
    return {
      insert: async (input) => {
        const row = await this.#db.run.create({
          data: {
            id: input.id,
            tenantId: input.tenantId,
            ownerId: input.ownerId,
            taskType: input.taskType,
            request: input.request as unknown as PrismaNs.InputJsonValue,
            policyVersion: input.policyVersion,
            idempotencyKeyId: input.idempotencyKeyId,
            status: 'PENDING',
          },
        });
        return mapRun(row as unknown as Record<string, unknown>);
      },

      findById: async (id) => {
        const row = await this.#db.run.findUnique({ where: { id } });
        return row ? mapRun(row as unknown as Record<string, unknown>) : null;
      },

      findByIdForTenant: async (id, tenantId) => {
        const row = await this.#db.run.findFirst({ where: { id, tenantId } });
        return row ? mapRun(row as unknown as Record<string, unknown>) : null;
      },

      listByTenant: async (tenantId, limit) => {
        const rows = await this.#db.run.findMany({ where: { tenantId }, orderBy: { createdAt: 'desc' }, take: limit });
        return rows.map((row) => mapRun(row as unknown as Record<string, unknown>));
      },

      transition: async (input) => {
        const patch = input.patch ?? {};
        const data: Record<string, unknown> = { status: input.to, version: { increment: 1 } };
        if (patch.startedAt !== undefined) data.startedAt = patch.startedAt;
        if (patch.completedAt !== undefined) data.completedAt = patch.completedAt;
        if (patch.attemptId !== undefined) data.attemptId = patch.attemptId;
        if (patch.attemptCount !== undefined) data.attemptCount = patch.attemptCount;
        if (patch.heartbeatAt !== undefined) data.heartbeatAt = patch.heartbeatAt;
        if (patch.tokenUsage !== undefined) data.tokenUsage = patch.tokenUsage as unknown as PrismaNs.InputJsonValue;
        if (patch.result !== undefined) data.result = patch.result as unknown as PrismaNs.InputJsonValue;
        if (patch.errorCode !== undefined) data.errorCode = patch.errorCode;
        if (patch.errorMessage !== undefined) data.errorMessage = patch.errorMessage;

        const updated = await this.#db.run.updateMany({
          where: { id: input.id, version: input.expectedVersion },
          data: data as PrismaNs.RunUpdateManyMutationInput,
        });
        if (updated.count === 0) return null;
        const row = await this.#db.run.findUnique({ where: { id: input.id } });
        return row ? mapRun(row as unknown as Record<string, unknown>) : null;
      },

      touch: async (id, attemptId, at) => {
        await this.#db.run.updateMany({ where: { id, attemptId }, data: { heartbeatAt: at } });
      },

      recordUsage: async (id, attemptId, usage: TokenUsage, at) => {
        await this.#db.run.updateMany({
          where: { id, attemptId },
          data: { tokenUsage: usage as unknown as PrismaNs.InputJsonValue, heartbeatAt: at },
        });
      },

      findStaleRunning: async (cutoff, limit) => {
        const rows = await this.#db.run.findMany({
          where: {
            status: 'RUNNING',
            OR: [{ heartbeatAt: { lt: cutoff } }, { heartbeatAt: null, updatedAt: { lt: cutoff } }],
          },
          orderBy: { updatedAt: 'asc' },
          take: limit,
        });
        return rows.map((row) => mapRun(row as unknown as Record<string, unknown>));
      },

      findByStatus: async (status, limit) => {
        const rows = await this.#db.run.findMany({
          where: { status: status as PrismaNs.EnumRunStatusFilter },
          orderBy: { updatedAt: 'asc' },
          take: limit,
        });
        return rows.map((row) => mapRun(row as unknown as Record<string, unknown>));
      },
    };
  }

  // ---------------------------------------------------------------------------
  // Steps and events (ordered, append-only)
  // ---------------------------------------------------------------------------

  get steps(): StepStore {
    return {
      append: async (input) => {
        for (let attempt = 0; attempt < 5; attempt += 1) {
          const aggregate = await this.#db.runStep.aggregate({ where: { runId: input.runId }, _max: { sequence: true } });
          const sequence = (aggregate._max.sequence ?? 0) + 1;
          try {
            const row = await this.#db.runStep.create({
              data: {
                runId: input.runId,
                sequence,
                attemptId: input.attemptId,
                stepType: input.stepType,
                status: input.status,
                summary: input.summary ?? null,
                payload: (input.payload ?? undefined) as PrismaNs.InputJsonValue | undefined,
                errorCode: input.errorCode ?? null,
                errorMessage: input.errorMessage ?? null,
                retryable: input.retryable ?? null,
                latencyMs: input.latencyMs ?? null,
                ...(input.status === 'STARTED' ? {} : { completedAt: new Date() }),
              },
            });
            return mapStep(row as unknown as Record<string, unknown>);
          } catch (error) {
            if (!isUniqueViolation(error)) throw error;
          }
        }
        throw new Error(`Could not append a run step for run ${input.runId} after repeated sequence contention.`);
      },

      listByRun: async (runId) => {
        const rows = await this.#db.runStep.findMany({ where: { runId }, orderBy: { sequence: 'asc' } });
        return rows.map((row) => mapStep(row as unknown as Record<string, unknown>));
      },

      countToolCalls: async (runId, attemptId) => {
        return this.#db.runStep.count({ where: { runId, attemptId, stepType: 'TOOL_CALL' } });
      },
    };
  }

  get events(): EventStore {
    return {
      append: async (input) => {
        for (let attempt = 0; attempt < 5; attempt += 1) {
          const aggregate = await this.#db.runEvent.aggregate({ where: { runId: input.runId }, _max: { sequence: true } });
          const sequence = (aggregate._max.sequence ?? 0) + 1;
          try {
            const row = await this.#db.runEvent.create({
              data: {
                runId: input.runId,
                sequence,
                eventType: input.eventType,
                version: input.version ?? 1,
                payload: input.payload as PrismaNs.InputJsonValue,
              },
            });
            return mapEvent(row as unknown as Record<string, unknown>);
          } catch (error) {
            if (!isUniqueViolation(error)) throw error;
          }
        }
        throw new Error(`Could not append a run event for run ${input.runId} after repeated sequence contention.`);
      },

      listByRun: async (runId, afterSequence, limit) => {
        const rows = await this.#db.runEvent.findMany({
          where: { runId, sequence: { gt: afterSequence } },
          orderBy: { sequence: 'asc' },
          take: limit,
        });
        return rows.map((row) => mapEvent(row as unknown as Record<string, unknown>));
      },

      maxSequence: async (runId) => {
        const aggregate = await this.#db.runEvent.aggregate({ where: { runId }, _max: { sequence: true } });
        return aggregate._max.sequence ?? 0;
      },
    };
  }

  // ---------------------------------------------------------------------------
  // Outbox
  // ---------------------------------------------------------------------------

  get outbox(): OutboxStore {
    return {
      enqueue: async (input) => {
        try {
          const row = await this.#db.outboxEvent.create({
            data: {
              topic: input.topic,
              payload: input.payload as PrismaNs.InputJsonValue,
              dedupeKey: input.dedupeKey,
            },
          });
          return mapOutbox(row as unknown as Record<string, unknown>);
        } catch (error) {
          if (!isUniqueViolation(error)) throw error;
          const existing = await this.#db.outboxEvent.findUnique({ where: { dedupeKey: input.dedupeKey } });
          if (!existing) throw new UniqueViolation(`Outbox message ${input.dedupeKey} vanished after a unique conflict.`);
          return mapOutbox(existing as unknown as Record<string, unknown>);
        }
      },

      claimDueBatch: async (limit, now) => {
        // Atomic claim with a lease. SKIP LOCKED keeps concurrent dispatchers from
        // colliding on the same rows.
        const rows = await this.#db.$queryRaw<Array<Record<string, unknown>>>(Prisma.sql`
          UPDATE outbox_events
             SET attempts = attempts + 1,
                 available_at = ${new Date(now.getTime() + 30_000)}
           WHERE id IN (
             SELECT id FROM outbox_events
              WHERE status = 'PENDING' AND available_at <= ${now}
              ORDER BY available_at ASC
              LIMIT ${limit}
              FOR UPDATE SKIP LOCKED
           )
          RETURNING id, topic, payload, dedupe_key AS "dedupeKey", status, attempts,
                    last_error AS "lastError", available_at AS "availableAt",
                    created_at AS "createdAt", dispatched_at AS "dispatchedAt"
        `);
        return rows.map((row) => mapOutbox(row));
      },

      markDispatched: async (id, at) => {
        await this.#db.outboxEvent.updateMany({
          where: { id },
          data: { status: 'DISPATCHED', dispatchedAt: at, lastError: null },
        });
      },

      markFailed: async (id, error, retryAt) => {
        const row = await this.#db.outboxEvent.findUnique({ where: { id } });
        const exhausted = (row?.attempts ?? 0) >= 5;
        await this.#db.outboxEvent.updateMany({
          where: { id },
          data: {
            status: exhausted ? 'FAILED' : 'PENDING',
            lastError: error,
            availableAt: retryAt,
          },
        });
      },
    };
  }

  // ---------------------------------------------------------------------------
  // Idempotency
  // ---------------------------------------------------------------------------

  get idempotency(): IdempotencyStore {
    return {
      claim: async (input) => {
        try {
          const row = await this.#db.idempotencyKey.create({
            data: {
              id: input.id,
              scope: input.scope,
              key: input.key,
              tenantId: input.tenantId,
              requestHash: input.requestHash,
              status: 'IN_PROGRESS',
            },
          });
          return { claimed: true, record: mapIdempotency(row as unknown as Record<string, unknown>) };
        } catch (error) {
          if (!isUniqueViolation(error)) throw error;
          const existing = await this.#db.idempotencyKey.findUnique({
            where: { scope_key: { scope: input.scope, key: input.key } },
          });
          if (!existing) throw error;
          return { claimed: false, record: mapIdempotency(existing as unknown as Record<string, unknown>) };
        }
      },

      complete: async (id, input) => {
        await this.#db.idempotencyKey.update({
          where: { id },
          data: {
            status: 'COMPLETED',
            statusCode: input.statusCode,
            responseBody: input.responseBody as PrismaNs.InputJsonValue,
            resourceId: input.resourceId,
          },
        });
      },

      fail: async (id, input) => {
        await this.#db.idempotencyKey.update({
          where: { id },
          data: {
            status: 'FAILED',
            statusCode: input.statusCode,
            responseBody: input.responseBody as PrismaNs.InputJsonValue,
          },
        });
      },
    };
  }

  // ---------------------------------------------------------------------------
  // Financial reference data
  // ---------------------------------------------------------------------------

  get financial(): FinancialStore {
    return {
      findSupplier: async (tenantId, supplierId) => {
        const row = await this.#db.supplier.findFirst({ where: { id: supplierId, tenantId } });
        return row ? mapSupplier(row as unknown as Record<string, unknown>) : null;
      },

      listSuppliers: async (tenantId, query) => {
        const rows = await this.#db.supplier.findMany({
          where: { tenantId, ...(query.activeOnly ? { active: true } : {}) },
          orderBy: { externalRef: 'asc' },
          take: query.limit,
        });
        return rows.map((row) => mapSupplier(row as unknown as Record<string, unknown>));
      },

      findTransaction: async (tenantId, transactionId) => {
        const row = await this.#db.transaction.findFirst({ where: { id: transactionId, tenantId } });
        return row ? mapTransaction(row as unknown as Record<string, unknown>) : null;
      },

      queryTransactions: async (query: TransactionQuery) => {
        const rows = await this.#db.transaction.findMany({
          where: {
            tenantId: query.tenantId,
            occurredAt: { gte: new Date(query.from), lte: new Date(`${query.to}T23:59:59.999Z`) },
            ...(query.supplierIds && query.supplierIds.length > 0 ? { supplierId: { in: query.supplierIds } } : {}),
            ...(query.category ? { category: query.category } : {}),
            ...(query.minAmountMinor !== undefined ? { amountMinor: { gte: query.minAmountMinor } } : {}),
          },
          orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }],
          take: query.limit,
        });
        return rows.map((row) => mapTransaction(row as unknown as Record<string, unknown>));
      },

      sumRefundsForTransaction: async (tenantId, transactionId) => {
        const rows = await this.#db.refundProposal.groupBy({
          by: ['status'],
          where: { tenantId, transactionId },
          _sum: { amountMinor: true },
        });
        let activeMinor = 0;
        let settledMinor = 0;
        for (const row of rows) {
          const total = row._sum.amountMinor ?? 0;
          if (row.status === 'SETTLED') settledMinor += total;
          else if (row.status === 'REQUIRES_APPROVAL' || row.status === 'APPROVED') activeMinor += total;
        }
        return { activeMinor, settledMinor };
      },
    };
  }

  // ---------------------------------------------------------------------------
  // Proposals
  // ---------------------------------------------------------------------------

  get proposals(): ProposalStore {
    return {
      insert: async (input) => {
        const row = await this.#db.refundProposal.create({
          data: {
            id: input.id,
            tenantId: input.tenantId,
            runId: input.runId,
            supplierId: input.supplierId,
            transactionId: input.transactionId,
            amountMinor: input.amountMinor,
            currency: input.currency,
            refundableAmountMinor: input.refundableAmountMinor,
            justification: input.justification,
            evidence: input.evidence as PrismaNs.InputJsonValue,
            status: input.status,
            reviewedHash: input.reviewedHash,
            revision: input.revision,
            policyVersion: input.policyVersion,
            policyDecision: input.policyDecision as unknown as PrismaNs.InputJsonValue,
            requiresApproval: input.requiresApproval,
          },
        });
        return mapProposal(row as unknown as Record<string, unknown>);
      },

      findById: async (id) => {
        const row = await this.#db.refundProposal.findUnique({ where: { id } });
        return row ? mapProposal(row as unknown as Record<string, unknown>) : null;
      },

      findByIdForTenant: async (id, tenantId) => {
        const row = await this.#db.refundProposal.findFirst({ where: { id, tenantId } });
        return row ? mapProposal(row as unknown as Record<string, unknown>) : null;
      },

      listByRun: async (runId) => {
        const rows = await this.#db.refundProposal.findMany({ where: { runId }, orderBy: { createdAt: 'asc' } });
        return rows.map((row) => mapProposal(row as unknown as Record<string, unknown>));
      },

      transition: async (input) => {
        const where: Record<string, unknown> = { id: input.id, status: input.from };
        if (input.expectedRevision !== undefined) where.revision = input.expectedRevision;
        const updated = await this.#db.refundProposal.updateMany({
          where: where as PrismaNs.RefundProposalWhereInput,
          data: { status: input.to },
        });
        if (updated.count === 0) return null;
        const row = await this.#db.refundProposal.findUnique({ where: { id: input.id } });
        return row ? mapProposal(row as unknown as Record<string, unknown>) : null;
      },

      revise: async (input) => {
        const data: Record<string, unknown> = { revision: { increment: 1 } };
        for (const [key, value] of Object.entries(input.patch)) {
          if (value !== undefined) data[key] = key === 'evidence' ? (value as PrismaNs.InputJsonValue) : value;
        }
        const updated = await this.#db.refundProposal.updateMany({
          where: { id: input.id, revision: input.expectedRevision },
          data: data as PrismaNs.RefundProposalUpdateManyMutationInput,
        });
        if (updated.count === 0) return null;
        const row = await this.#db.refundProposal.findUnique({ where: { id: input.id } });
        return row ? mapProposal(row as unknown as Record<string, unknown>) : null;
      },

      countConflicting: async (tenantId, transactionId, excludeProposalId) => {
        return this.#db.refundProposal.count({
          where: {
            tenantId,
            transactionId,
            status: { in: ['REQUIRES_APPROVAL', 'APPROVED', 'SETTLED'] },
            ...(excludeProposalId ? { id: { not: excludeProposalId } } : {}),
          },
        });
      },
    };
  }

  // ---------------------------------------------------------------------------
  // Approvals
  // ---------------------------------------------------------------------------

  get approvals(): ApprovalStore {
    return {
      insert: async (input) => {
        const row = await this.#db.approvalRequest.create({
          data: {
            id: input.id,
            tenantId: input.tenantId,
            runId: input.runId,
            proposalId: input.proposalId,
            status: 'PENDING',
            proposalRevision: input.proposalRevision,
            proposalHash: input.proposalHash,
            reviewedSnapshot: input.reviewedSnapshot as PrismaNs.InputJsonValue,
            expiresAt: input.expiresAt,
          },
        });
        return mapApproval(row as unknown as Record<string, unknown>);
      },

      findById: async (id) => {
        const row = await this.#db.approvalRequest.findUnique({ where: { id } });
        return row ? mapApproval(row as unknown as Record<string, unknown>) : null;
      },

      findByIdForTenant: async (id, tenantId) => {
        const row = await this.#db.approvalRequest.findFirst({ where: { id, tenantId } });
        return row ? mapApproval(row as unknown as Record<string, unknown>) : null;
      },

      findByProposalId: async (proposalId) => {
        const row = await this.#db.approvalRequest.findUnique({ where: { proposalId } });
        return row ? mapApproval(row as unknown as Record<string, unknown>) : null;
      },

      decide: async (input) => {
        // The `status: 'PENDING'` filter is the whole concurrency control: a second
        // decision updates zero rows.
        const updated = await this.#db.approvalRequest.updateMany({
          where: { id: input.id, status: 'PENDING' },
          data: {
            status: input.to,
            decidedAt: input.decidedAt,
            decidedById: input.decidedById,
            decisionReason: input.reason,
          },
        });
        if (updated.count === 0) return null;
        const row = await this.#db.approvalRequest.findUnique({ where: { id: input.id } });
        return row ? mapApproval(row as unknown as Record<string, unknown>) : null;
      },

      expire: async (id, at) => {
        const updated = await this.#db.approvalRequest.updateMany({
          where: { id, status: 'PENDING' },
          data: { status: 'EXPIRED', decidedAt: at },
        });
        if (updated.count === 0) return null;
        const row = await this.#db.approvalRequest.findUnique({ where: { id } });
        return row ? mapApproval(row as unknown as Record<string, unknown>) : null;
      },

      cancel: async (id, at) => {
        const updated = await this.#db.approvalRequest.updateMany({
          where: { id, status: 'PENDING' },
          data: { status: 'CANCELLED', decidedAt: at },
        });
        if (updated.count === 0) return null;
        const row = await this.#db.approvalRequest.findUnique({ where: { id } });
        return row ? mapApproval(row as unknown as Record<string, unknown>) : null;
      },

      findExpired: async (now, limit) => {
        const rows = await this.#db.approvalRequest.findMany({
          where: { status: 'PENDING', expiresAt: { lte: now } },
          orderBy: { expiresAt: 'asc' },
          take: limit,
        });
        return rows.map((row) => mapApproval(row as unknown as Record<string, unknown>));
      },
    };
  }

  // ---------------------------------------------------------------------------
  // Settlement + ledger
  // ---------------------------------------------------------------------------

  get settlements(): SettlementStore {
    return {
      findByProposalId: async (proposalId) => {
        const row = await this.#db.settlementOperation.findUnique({ where: { proposalId } });
        return row ? mapSettlement(row as unknown as Record<string, unknown>) : null;
      },

      findByOperationId: async (operationId) => {
        const row = await this.#db.settlementOperation.findUnique({ where: { operationId } });
        return row ? mapSettlement(row as unknown as Record<string, unknown>) : null;
      },

      insert: async (input) => {
        const row = await this.#db.settlementOperation.create({
          data: {
            id: input.id,
            operationId: input.operationId,
            tenantId: input.tenantId,
            runId: input.runId,
            proposalId: input.proposalId,
            status: input.status,
          },
        });
        return mapSettlement(row as unknown as Record<string, unknown>);
      },

      transition: async (input) => {
        const updated = await this.#db.settlementOperation.updateMany({
          where: { id: input.id, status: input.from },
          data: {
            status: input.to,
            ...(input.ledgerEntryId !== undefined ? { ledgerEntryId: input.ledgerEntryId } : {}),
            ...(input.lastError !== undefined ? { lastError: input.lastError } : {}),
            ...(input.to === 'COMMITTED' ? { committedAt: new Date() } : {}),
          },
        });
        if (updated.count === 0) return null;
        const row = await this.#db.settlementOperation.findUnique({ where: { id: input.id } });
        return row ? mapSettlement(row as unknown as Record<string, unknown>) : null;
      },

      incrementAttempts: async (id) => {
        await this.#db.settlementOperation.update({ where: { id }, data: { attempts: { increment: 1 } } });
      },
    };
  }

  get ledger(): LedgerStore {
    return {
      // The only write available. There is deliberately no update or delete path:
      // immutability is enforced here and again by a database trigger.
      insert: async (input) => {
        const row = await this.#db.ledgerEntry.create({
          data: {
            id: input.id,
            tenantId: input.tenantId,
            operationId: input.operationId,
            proposalId: input.proposalId,
            supplierId: input.supplierId,
            entryType: 'REFUND',
            amountMinor: input.amountMinor,
            currency: input.currency,
            memo: input.memo,
            entryHash: input.entryHash,
          },
        });
        return mapLedgerEntry(row as unknown as Record<string, unknown>);
      },

      findByOperationId: async (operationId) => {
        const row = await this.#db.ledgerEntry.findUnique({ where: { operationId } });
        return row ? mapLedgerEntry(row as unknown as Record<string, unknown>) : null;
      },

      findById: async (id) => {
        const row = await this.#db.ledgerEntry.findUnique({ where: { id } });
        return row ? mapLedgerEntry(row as unknown as Record<string, unknown>) : null;
      },

      countByProposal: async (proposalId) => {
        return this.#db.ledgerEntry.count({ where: { proposalId } });
      },
    };
  }

  // ---------------------------------------------------------------------------
  // Audit
  // ---------------------------------------------------------------------------

  get audit(): AuditStore {
    return {
      append: async (input: AuditInput) => {
        const row = await this.#db.auditEvent.create({
          data: {
            tenantId: input.tenantId,
            runId: input.runId ?? null,
            actorType: input.actorType,
            actorId: input.actorId ?? null,
            action: input.action,
            targetType: input.targetType,
            targetId: input.targetId ?? null,
            metadata: (input.metadata ?? undefined) as PrismaNs.InputJsonValue | undefined,
          },
        });
        return mapAudit(row as unknown as Record<string, unknown>) as AuditRecord;
      },

      listByRun: async (runId, limit) => {
        const rows = await this.#db.auditEvent.findMany({ where: { runId }, orderBy: { createdAt: 'asc' }, take: limit });
        return rows.map((row) => mapAudit(row as unknown as Record<string, unknown>));
      },
    };
  }

  // ---------------------------------------------------------------------------
  // Users
  // ---------------------------------------------------------------------------

  get users(): UserStore {
    return {
      findBySubject: async (subject) => {
        const row = await this.#db.user.findUnique({ where: { subject } });
        return row ? mapUser(row as unknown as Record<string, unknown>) : null;
      },

      findById: async (id) => {
        const row = await this.#db.user.findUnique({ where: { id } });
        return row ? mapUser(row as unknown as Record<string, unknown>) : null;
      },

      upsert: async (input) => {
        const row = await this.#db.user.upsert({
          where: { subject: input.subject },
          update: { email: input.email, name: input.name, role: input.role, tenantId: input.tenantId },
          create: {
            tenantId: input.tenantId,
            subject: input.subject,
            email: input.email,
            name: input.name,
            role: input.role,
          },
        });
        return mapUser(row as unknown as Record<string, unknown>);
      },
    };
  }
}

export function createPrismaClient(): PrismaClientType {
  return new PrismaClient();
}

export { NotFoundError, UniqueViolation };

export type { RunStatus, ProposalStatus, ApprovalStatus, SettlementStatus, PolicyDecision };
