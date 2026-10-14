/**
 * Outbox dispatcher — SRS-RUN-004, SRS-QUEUE-003/005, SRS §7.2.
 *
 * Application code never talks to Redis. It writes an outbox row in the same
 * transaction as the state change, and this dispatcher publishes those rows
 * afterwards. That is what closes the database→queue gap: if the process dies
 * between the commit and the publish, the row is still PENDING and will be
 * picked up on the next sweep.
 *
 * Publication failure is retried with exponential backoff up to a bounded number
 * of attempts; after that the row is marked FAILED and stays visible for an
 * operator rather than being silently dropped.
 */
import type { Clock, LoggerPort, OutboxRecord, Store } from '../ports.js';
import type { QueuePort, RunJobPayload } from '../ports.js';

export interface OutboxDispatcherDeps {
  store: Store;
  queue: QueuePort;
  clock: Clock;
  logger: LoggerPort;
  maxAttempts: number;
  batchSize: number;
}

export interface DispatchCycleResult {
  claimed: number;
  dispatched: number;
  failed: number;
}

export class OutboxDispatcher {
  readonly #deps: OutboxDispatcherDeps;

  constructor(deps: OutboxDispatcherDeps) {
    this.#deps = deps;
  }

  async dispatchOnce(): Promise<DispatchCycleResult> {
    const { store, clock, logger } = this.#deps;
    const due = await store.outbox.claimDueBatch(this.#deps.batchSize, clock.now());

    const result: DispatchCycleResult = { claimed: due.length, dispatched: 0, failed: 0 };

    for (const record of due) {
      try {
        await this.#publish(record);
        await store.outbox.markDispatched(record.id, clock.now());
        result.dispatched += 1;
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown dispatch failure.';
        // `claimDueBatch` already incremented the attempt counter atomically, so
        // this value includes the current attempt.
        const attempts = record.attempts;
        const exhausted = attempts >= this.#deps.maxAttempts;
        // Exponential backoff, capped at one minute, so a Redis outage does not
        // turn into a hot loop.
        const delayMs = exhausted ? 0 : Math.min(60_000, 500 * 2 ** attempts);
        await store.outbox.markFailed(record.id, message, new Date(clock.now().getTime() + delayMs));
        result.failed += 1;
        logger.error({ outboxId: record.id, topic: record.topic, attempts, exhausted, error: message }, 'outbox dispatch failed');
      }
    }

    return result;
  }

  async #publish(record: OutboxRecord): Promise<void> {
    const job = toRunJob(record);
    if (!job) throw new Error(`Unknown outbox topic "${record.topic}".`);
    // Deterministic job id: a re-published message cannot create a second job for
    // the same logical attempt.
    await this.#deps.queue.enqueueRun(job, { jobId: `${record.topic}:${record.dedupeKey}` });
  }
}

/**
 * Translates a durable outbox message into a queue job.
 *
 * Exported so tests drive the *same* mapping the dispatcher uses instead of
 * re-implementing it — a test that mirrors production logic proves nothing about
 * production logic.
 */
export function toRunJob(record: Pick<OutboxRecord, 'id' | 'topic' | 'payload' | 'dedupeKey'>): RunJobPayload | null {
  if (record.topic !== 'run.execute' && record.topic !== 'run.resume') return null;
  const payload = record.payload as unknown as Partial<RunJobPayload>;
  if (typeof payload.runId !== 'string') throw new Error(`Outbox message ${record.dedupeKey} has no runId.`);
  return {
    version: payload.version ?? 1,
    runId: payload.runId,
    // A resumption message has no attempt of its own: the resumed segment mints
    // the next attempt, so this value is only an identifier for logging.
    attemptId: payload.attemptId ?? `resume-${record.id}`,
    attemptCount: payload.attemptCount ?? 1,
    reason: record.topic === 'run.resume' ? 'APPROVAL_RESUME' : (payload.reason ?? 'SUBMITTED'),
  };
}
