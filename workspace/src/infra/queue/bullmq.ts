/**
 * BullMQ queue adapter — SRS-QUEUE-001..006, PR-02.
 *
 * Two responsibilities:
 *  * `BullMqQueue` publishes run jobs. The application never calls it directly:
 *    it writes an outbox row and the dispatcher publishes from there.
 *  * `createRunWorker` consumes them, with bounded attempts and exponential
 *    backoff. BullMQ's `attempts` covers infrastructure-level failures only; the
 *    workflow's own attempt accounting lives in PostgreSQL (see the workflow
 *    service), because Redis does not guarantee exactly-once delivery.
 *
 * Queue messages carry stable identifiers (`runId`, `attemptId`) and never act as
 * the authoritative business record.
 */
import { Queue, Worker, type JobsOptions } from 'bullmq';
import { Redis, type RedisOptions } from 'ioredis';
import type { LoggerPort, QueuePort, RunJobPayload } from '../../app/ports.js';

export function redisConnectionOptions(url: string): RedisOptions {
  const parsed = new URL(url);
  const db = parsed.pathname.replace('/', '');
  const options: RedisOptions = {
    host: parsed.hostname,
    port: Number(parsed.port || 6379),
    ...(parsed.username ? { username: decodeURIComponent(parsed.username) } : {}),
    ...(parsed.password ? { password: decodeURIComponent(parsed.password) } : {}),
    ...(db ? { db: Number(db) } : {}),
    ...(parsed.protocol === 'rediss:' ? { tls: {} } : {}),
    // Keep the local demos from hanging for a minute on a dead Redis.
    maxRetriesPerRequest: null,
    enableOfflineQueue: true,
    connectTimeout: 5_000,
  };
  return options;
}

export interface QueueConfig {
  name: string;
  prefix: string;
  redisUrl: string;
  attempts: number;
  backoffMs: number;
}

/**
 * BullMQ keys are colon-joined, and BullMQ rejects custom job ids containing a
 * colon, so dedupe keys are flattened before use.
 */
export function sanitizeJobId(value: string): string {
  return value.replace(/[:\s]/g, '_').slice(0, 200);
}

export class BullMqQueue implements QueuePort {
  readonly #queue: Queue<RunJobPayload>;
  readonly #logger: LoggerPort;

  constructor(config: QueueConfig, logger: LoggerPort) {
    this.#logger = logger;
    this.#queue = new Queue<RunJobPayload>(config.name, {
      connection: redisConnectionOptions(config.redisUrl),
      prefix: config.prefix,
      defaultJobOptions: {
        attempts: config.attempts,
        backoff: { type: 'exponential', delay: config.backoffMs },
        removeOnComplete: { age: 3_600, count: 1_000 },
        removeOnFail: { age: 86_400, count: 5_000 },
      },
    });
  }

  async enqueueRun(payload: RunJobPayload, options: { jobId?: string; delayMs?: number } = {}): Promise<void> {
    const jobOptions: JobsOptions = {};
    if (options.jobId) jobOptions.jobId = sanitizeJobId(options.jobId);
    if (options.delayMs) jobOptions.delay = options.delayMs;

    await this.#queue.add('execute-run', payload, jobOptions);
    this.#logger.debug({ runId: payload.runId, attemptId: payload.attemptId, reason: payload.reason }, 'run job enqueued');
  }

  async counts(): Promise<Record<string, number>> {
    return this.#queue.getJobCounts('waiting', 'active', 'delayed', 'failed', 'completed');
  }

  async close(): Promise<void> {
    await this.#queue.close();
  }
}

export interface RunWorkerOptions {
  config: QueueConfig;
  logger: LoggerPort;
  concurrency: number;
  handler: (payload: RunJobPayload) => Promise<void>;
}

export interface RunWorkerHandle {
  worker: Worker<RunJobPayload>;
  close(): Promise<void>;
}

export function createRunWorker(options: RunWorkerOptions): RunWorkerHandle {
  const worker = new Worker<RunJobPayload>(
    options.config.name,
    async (job) => {
      const payload = job.data;
      options.logger.info(
        { jobId: job.id, runId: payload.runId, attemptId: payload.attemptId, attempt: job.attemptsMade + 1 },
        'processing run job',
      );
      await options.handler(payload);
    },
    {
      connection: redisConnectionOptions(options.config.redisUrl),
      prefix: options.config.prefix,
      concurrency: options.concurrency,
      // Graceful shutdown: finish the current job, accept nothing new.
      autorun: true,
    },
  );

  worker.on('failed', (job, error) => {
    options.logger.error(
      { jobId: job?.id, runId: job?.data.runId, attemptsMade: job?.attemptsMade, error: error.message },
      'run job failed',
    );
  });

  worker.on('error', (error) => {
    options.logger.error({ error: error.message }, 'run worker error');
  });

  return {
    worker,
    close: async () => {
      await worker.close();
    },
  };
}

/** Raw Redis handle used only for health checks. */
export function createRedisClient(redisUrl: string): Redis {
  return new Redis({ ...redisConnectionOptions(redisUrl), lazyConnect: false, maxRetriesPerRequest: 1, retryStrategy: () => null });
}
