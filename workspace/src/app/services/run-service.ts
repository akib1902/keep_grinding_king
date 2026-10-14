/**
 * Run submission and retrieval — PR-01, PR-11, SRS-RUN-001..007.
 *
 * Submission is the place where the database→queue dual-write gap would normally
 * appear: write the run, then hope the enqueue succeeds. Instead the run and its
 * outbox message are written in a single transaction, and a dispatcher publishes
 * the message afterwards. If the process dies between the two, the durable outbox
 * row is still there to be picked up.
 */
import { canonicalJson, deriveAttemptId, newId, sha256 } from '../../domain/ids.js';
import { AppError, ErrorCode, conflict, forbidden, notFound } from '../../domain/errors.js';
import { assertRunTransition, isTerminalRunStatus, type RunStatus } from '../../domain/state.js';
import { emitEvent, recordAudit, recordStep } from './telemetry.js';
import type {
  Clock,
  LoggerPort,
  RunEventRecord,
  RunRecord,
  RunRequest,
  RunStepRecord,
  Store,
} from '../ports.js';

export interface RunSubmissionInput {
  tenantId: string;
  userId: string;
  request: RunRequest;
  idempotencyKey: string | null;
}

export interface RunSubmissionResult {
  runId: string;
  status: RunStatus;
  /** True when an identical earlier request was replayed. */
  idempotentReplay: boolean;
}

export interface RunContext {
  userId: string;
  tenantId: string;
  role: 'ANALYST' | 'APPROVER' | 'ADMIN';
}

export interface RunServiceDeps {
  store: Store;
  clock: Clock;
  logger: LoggerPort;
  policyVersion: string;
}

const IDEMPOTENCY_SCOPE = 'POST /api/runs';

export class RunService {
  readonly #deps: RunServiceDeps;

  constructor(deps: RunServiceDeps) {
    this.#deps = deps;
  }

  async submit(input: RunSubmissionInput): Promise<RunSubmissionResult> {
    const { store, logger, policyVersion } = this.#deps;
    const requestHash = sha256(canonicalJson({ ...input.request, tenantId: input.tenantId, userId: input.userId }));
    const runId = newId();

    let idempotencyId: string | null = null;
    if (input.idempotencyKey) {
      const claim = await store.idempotency.claim({
        id: newId(),
        scope: IDEMPOTENCY_SCOPE,
        key: input.idempotencyKey,
        tenantId: input.tenantId,
        requestHash,
      });

      if (!claim.claimed) {
        const existing = claim.record;
        if (existing.requestHash !== requestHash) {
          throw conflict(
            ErrorCode.IDEMPOTENCY_KEY_REUSED,
            'This idempotency key was already used with a different request payload.',
            { key: input.idempotencyKey },
          );
        }
        if (existing.status === 'IN_PROGRESS') {
          throw conflict(
            ErrorCode.IDEMPOTENCY_IN_PROGRESS,
            'An identical request is still being processed; retry shortly.',
            { key: input.idempotencyKey },
          );
        }
        if (!existing.resourceId) {
          throw conflict(ErrorCode.IDEMPOTENCY_IN_PROGRESS, 'The original request did not produce a run.', {
            key: input.idempotencyKey,
          });
        }
        logger.info({ runId: existing.resourceId, key: input.idempotencyKey }, 'idempotent run submission replayed');
        return { runId: existing.resourceId, status: 'PENDING', idempotentReplay: true };
      }
      idempotencyId = claim.record.id;
    }

    try {
      const run = await store.transaction(async (tx) => {
        const created = await tx.runs.insert({
          id: runId,
          tenantId: input.tenantId,
          ownerId: input.userId,
          taskType: input.request.taskType,
          request: input.request,
          policyVersion,
          idempotencyKeyId: idempotencyId,
        });

        const attemptId = deriveAttemptId(created.id, 1);
        await recordStep(tx, {
          runId: created.id,
          attemptId,
          stepType: 'RUN_ACCEPTED',
          status: 'SUCCEEDED',
          summary: 'Run accepted and queued for asynchronous execution',
          payload: { taskType: input.request.taskType, window: { from: input.request.from, to: input.request.to } },
        });

        await emitEvent(tx, {
          runId: created.id,
          eventType: 'run.accepted',
          payload: {
            runId: created.id,
            status: created.status,
            taskType: created.taskType,
            window: { from: input.request.from, to: input.request.to },
            policyVersion,
          },
        });

        await recordAudit(tx, {
          tenantId: input.tenantId,
          runId: created.id,
          actorType: 'USER',
          actorId: input.userId,
          action: 'run.submitted',
          targetType: 'run',
          targetId: created.id,
          metadata: { taskType: input.request.taskType, idempotencyKey: input.idempotencyKey },
        });

        // Durable hand-off: the queue message is derived from this row, never the
        // other way round (SRS-RUN-004).
        await tx.outbox.enqueue({
          topic: 'run.execute',
          dedupeKey: `execute:run:${created.id}:attempt:${attemptId}`,
          payload: { version: 1, runId: created.id, attemptId, attemptCount: 1, reason: 'SUBMITTED' },
        });

        if (idempotencyId) {
          await tx.idempotency.complete(idempotencyId, {
            statusCode: 202,
            responseBody: { runId: created.id, status: created.status },
            resourceId: created.id,
          });
        }

        return created;
      });

      logger.info({ runId: run.id, tenantId: run.tenantId }, 'run submitted');
      return { runId: run.id, status: run.status, idempotentReplay: false };
    } catch (error) {
      if (idempotencyId) {
        await store.idempotency
          .fail(idempotencyId, { statusCode: 500, responseBody: { error: 'submission failed' } })
          .catch(() => undefined);
      }
      throw error;
    }
  }

  async get(runId: string, context: RunContext): Promise<RunRecord> {
    const run = await this.#deps.store.runs.findByIdForTenant(runId, context.tenantId);
    if (!run) throw notFound('Run not found.');
    this.#assertCanRead(run, context);
    return run;
  }

  async steps(runId: string, context: RunContext): Promise<RunStepRecord[]> {
    const run = await this.get(runId, context);
    return this.#deps.store.steps.listByRun(run.id);
  }

  async events(runId: string, context: RunContext, afterEventId?: string): Promise<RunEventRecord[]> {
    const run = await this.get(runId, context);
    const after =
      afterEventId === undefined
        ? 0
        : Number.isFinite(Number(afterEventId))
          ? Number(afterEventId)
          : await this.#sequenceFromEventUuid(run.id, afterEventId);
    return this.#deps.store.events.listByRun(run.id, after, 500);
  }

  async cancel(runId: string, context: RunContext): Promise<RunRecord> {
    const { store, clock } = this.#deps;
    const run = await this.get(runId, context);
    this.#assertCanRead(run, context);

    if (isTerminalRunStatus(run.status)) {
      throw conflict(ErrorCode.RUN_NOT_CANCELLABLE, `A ${run.status} run cannot be cancelled.`, { status: run.status });
    }
    assertRunTransition(run.status, 'CANCELLED');

    const now = clock.now();
    const updated = await store.transaction(async (tx) => {
      const result = await tx.runs.transition({
        id: run.id,
        expectedVersion: run.version,
        to: 'CANCELLED',
        patch: { completedAt: now },
      });
      if (!result) {
        throw conflict(ErrorCode.CONCURRENT_MODIFICATION, 'The run changed while the cancellation was applied.');
      }
      await recordStep(tx, {
        runId: run.id,
        attemptId: run.attemptId,
        stepType: 'ATTEMPT_FAILED',
        status: 'SKIPPED',
        summary: `Run cancelled by user ${context.userId}`,
      });
      await emitEvent(tx, { runId: run.id, eventType: 'run.cancelled', payload: { runId: run.id, cancelledBy: context.userId } });
      await recordAudit(tx, {
        tenantId: run.tenantId,
        runId: run.id,
        actorType: 'USER',
        actorId: context.userId,
        action: 'run.cancelled',
        targetType: 'run',
        targetId: run.id,
        metadata: { previousStatus: run.status },
      });
      return result;
    });

    return updated;
  }

  async list(context: RunContext, limit = 25): Promise<RunRecord[]> {
    return this.#deps.store.runs.listByTenant(context.tenantId, limit);
  }

  /** Proposals, approvals and settlements belonging to a run, for retrieval. */
  async history(runId: string, context: RunContext) {
    const run = await this.get(runId, context);
    const proposals = await this.#deps.store.proposals.listByRun(run.id);
    const approvals = await Promise.all(proposals.map((proposal) => this.#deps.store.approvals.findByProposalId(proposal.id)));
    const settlements = await Promise.all(proposals.map((proposal) => this.#deps.store.settlements.findByProposalId(proposal.id)));
    return { run, proposals, approvals: approvals.filter((a) => a !== null), settlements: settlements.filter((s) => s !== null) };
  }

  #assertCanRead(run: RunRecord, context: RunContext): void {
    if (context.role === 'ADMIN') return;
    if (run.ownerId === context.userId) return;
    // Deliberately indistinguishable from "does not exist" so resource ids cannot
    // be probed (SRS-AUTH-005).
    throw new AppError({
      code: ErrorCode.NOT_FOUND,
      message: 'Run not found.',
      category: 'AUTHORIZATION',
      httpStatus: 404,
      retryable: false,
    });
  }

  async #sequenceFromEventUuid(runId: string, eventId: string): Promise<number> {
    const events = await this.#deps.store.events.listByRun(runId, 0, 1000);
    const match = events.find((event) => event.id === eventId);
    if (!match) {
      throw forbidden('The supplied event id does not belong to this run.');
    }
    return match.sequence;
  }
}
