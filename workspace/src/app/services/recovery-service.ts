/**
 * Recovery and reconciliation — SRS-QUEUE-005, SRS-STATE-005/006, PR-02/PR-12.
 *
 * Three independent sweeps, each idempotent and each driven by the durable
 * database rather than by queue state:
 *
 *  1. `expireApprovals` — pending approvals past their expiry are closed and the
 *     proposal is marked EXPIRED. Expiry is never a settlement.
 *  2. `reconcilePausedRuns` — a run left in REQUIRES_HUMAN_APPROVAL whose approval
 *     is already final but whose resumption command never reached the queue (the
 *     process died between the commit and the publish) is re-armed from the
 *     database. This is what makes the outbox self-healing.
 *  3. `requeueStaleRuns` — a RUNNING attempt whose heartbeat stopped is either
 *     re-queued with the next attempt id (attempts remaining) or failed with a
 *     stable error code.
 */
import { deriveAttemptId } from '../../domain/ids.js';
import { conflict } from '../../domain/errors.js';
import { emitEvent, recordAudit, recordStep } from './telemetry.js';
import type { Clock, LoggerPort, Store } from '../ports.js';
import type { ApprovalService } from './approval-service.js';

export interface RecoveryServiceDeps {
  store: Store;
  clock: Clock;
  logger: LoggerPort;
  approvals: ApprovalService;
  staleAttemptMs: number;
  maxAttempts: number;
  batchSize: number;
}

export interface RecoveryCycleResult {
  approvalsExpired: number;
  runsRekeyed: number;
  staleRequeued: number;
  staleFailed: number;
}

export class RecoveryService {
  readonly #deps: RecoveryServiceDeps;

  constructor(deps: RecoveryServiceDeps) {
    this.#deps = deps;
  }

  async runOnce(): Promise<RecoveryCycleResult> {
    const result: RecoveryCycleResult = { approvalsExpired: 0, runsRekeyed: 0, staleRequeued: 0, staleFailed: 0 };
    result.approvalsExpired = await this.expireApprovals();
    result.runsRekeyed = await this.reconcilePausedRuns();
    const stale = await this.requeueStaleRuns();
    result.staleRequeued = stale.requeued;
    result.staleFailed = stale.failed;
    return result;
  }

  /** Closes pending approvals whose expiry has passed. */
  async expireApprovals(): Promise<number> {
    const { store, clock, logger } = this.#deps;
    const expired = await store.approvals.findExpired(clock.now(), this.#deps.batchSize);
    let count = 0;
    for (const approval of expired) {
      const done = await this.#deps.approvals.expire(approval.id, clock.now());
      if (done) {
        count += 1;
        // Persist the resumption command so the paused run can close honestly.
        await store.outbox.enqueue({
          topic: 'run.resume',
          dedupeKey: `resume:proposal:${approval.proposalId}:expired`,
          payload: { version: 1, runId: approval.runId, proposalId: approval.proposalId, approvalId: approval.id, decision: 'EXPIRED' },
        });
        logger.warn({ approvalId: approval.id, runId: approval.runId }, 'approval expired');
      }
    }
    return count;
  }

  /**
   * Re-arms paused runs whose approval is final but whose resumption command is
   * missing from the queue. The outbox dedupe key makes re-arming harmless.
   */
  async reconcilePausedRuns(): Promise<number> {
    const { store, clock, logger } = this.#deps;
    const paused = await store.runs.findByStatus('REQUIRES_HUMAN_APPROVAL', this.#deps.batchSize);
    let rekeyed = 0;

    for (const run of paused) {
      const proposals = await store.proposals.listByRun(run.id);
      for (const proposal of proposals) {
        const approval = await store.approvals.findByProposalId(proposal.id);
        if (!approval) continue;
        if (approval.status === 'PENDING') {
          if (approval.expiresAt.getTime() <= clock.now().getTime()) {
            await this.#deps.approvals.expire(approval.id, clock.now());
          }
          continue;
        }
        if (proposal.status === 'SETTLED') continue;

        const decision = approval.status.toLowerCase();
        const enqueued = await store.transaction(async (tx) => {
          const existing = await tx.outbox.enqueue({
            topic: 'run.resume',
            dedupeKey: `resume:proposal:${proposal.id}:${decision}`,
            payload: { version: 1, runId: run.id, proposalId: proposal.id, approvalId: approval.id, decision },
          });
          return existing.attempts === 0 && existing.status === 'PENDING';
        });
        if (enqueued) {
          rekeyed += 1;
          await recordStep(store, {
            runId: run.id,
            attemptId: run.attemptId,
            stepType: 'RECOVERY_REQUEUE',
            status: 'SUCCEEDED',
            summary: `Re-armed resumption for ${decision} approval ${approval.id}`,
          });
          await emitEvent(store, {
            runId: run.id,
            eventType: 'run.resume_rearmed',
            payload: { runId: run.id, approvalId: approval.id, proposalId: proposal.id, decision },
          });
          logger.warn({ runId: run.id, approvalId: approval.id }, 're-armed missing resumption command from durable state');
        }
      }
    }
    return rekeyed;
  }

  /**
   * Reconciles attempts whose worker disappeared. A stale attempt is re-queued
   * with a fresh attempt id while attempts remain, otherwise the run fails with a
   * stable code instead of hanging forever.
   */
  async requeueStaleRuns(): Promise<{ requeued: number; failed: number }> {
    const { store, clock, logger } = this.#deps;
    const cutoff = new Date(clock.now().getTime() - this.#deps.staleAttemptMs);
    const stale = await store.runs.findStaleRunning(cutoff, this.#deps.batchSize);

    let requeued = 0;
    let failed = 0;

    for (const run of stale) {
      const nextAttemptCount = run.attemptCount + 1;
      const canRetry = nextAttemptCount <= this.#deps.maxAttempts;

      if (!canRetry) {
        await store.transaction(async (tx) => {
          const updated = await tx.runs.transition({
            id: run.id,
            expectedVersion: run.version,
            to: 'FAILED',
            patch: {
              completedAt: clock.now(),
              errorCode: 'STALE_ATTEMPT_EXHAUSTED',
              errorMessage: `Attempt ${run.attemptCount} stopped reporting after ${this.#deps.staleAttemptMs}ms and no attempts remain.`,
            },
          });
          if (!updated) return;
          await emitEvent(tx, {
            runId: run.id,
            eventType: 'run.failed',
            payload: { runId: run.id, code: 'STALE_ATTEMPT_EXHAUSTED', attempts: run.attemptCount },
          });
          await recordAudit(tx, {
            tenantId: run.tenantId,
            runId: run.id,
            actorType: 'SYSTEM',
            action: 'run.failed_stale_attempt',
            targetType: 'run',
            targetId: run.id,
            metadata: { attemptId: run.attemptId, attemptCount: run.attemptCount },
          });
        });
        failed += 1;
        continue;
      }

      const nextAttemptId = deriveAttemptId(run.id, nextAttemptCount);
      const done = await store.transaction(async (tx) => {
        const updated = await tx.runs.transition({
          id: run.id,
          expectedVersion: run.version,
          to: 'PENDING',
          patch: { attemptId: null, attemptCount: nextAttemptCount - 1, heartbeatAt: null },
        });
        if (!updated) return false;
        await recordStep(tx, {
          runId: run.id,
          attemptId: run.attemptId,
          stepType: 'RECOVERY_REQUEUE',
          status: 'SUCCEEDED',
          summary: `Stale attempt re-queued as attempt ${nextAttemptCount}`,
          payload: { previousAttemptId: run.attemptId, nextAttemptId },
        });
        await tx.outbox.enqueue({
          topic: 'run.execute',
          dedupeKey: `execute:run:${run.id}:attempt:${nextAttemptId}`,
          payload: { version: 1, runId: run.id, attemptId: nextAttemptId, attemptCount: nextAttemptCount, reason: 'RECOVERY' },
        });
        await emitEvent(tx, {
          runId: run.id,
          eventType: 'run.recovered',
          payload: { runId: run.id, previousAttemptId: run.attemptId, nextAttemptCount },
        });
        return true;
      });

      if (done) requeued += 1;
    }

    if (requeued > 0 || failed > 0) {
      logger.warn({ requeued, failed }, 'stale attempt reconciliation applied');
    }
    return { requeued, failed };
  }

  /** Marks a run as cancelled on behalf of an operator when it is stuck. */
  async forceFail(runId: string, code: string, message: string): Promise<void> {
    const { store, clock } = this.#deps;
    await store.transaction(async (tx) => {
      const run = await tx.runs.findById(runId);
      if (!run) throw conflict('NOT_FOUND', 'Run not found.');
      const updated = await tx.runs.transition({
        id: run.id,
        expectedVersion: run.version,
        to: 'FAILED',
        patch: { completedAt: clock.now(), errorCode: code, errorMessage: message },
      });
      if (!updated) throw conflict('CONCURRENT_MODIFICATION', 'Run changed while force-failing.');
      await emitEvent(tx, { runId: run.id, eventType: 'run.failed', payload: { runId: run.id, code, message } });
      await recordAudit(tx, {
        tenantId: run.tenantId,
        runId: run.id,
        actorType: 'SYSTEM',
        action: 'run.force_failed',
        targetType: 'run',
        targetId: run.id,
        metadata: { code, message },
      });
    });
  }
}
