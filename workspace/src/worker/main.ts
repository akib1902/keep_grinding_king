/**
 * Worker process — PR-02, SRS §10.
 *
 * One process hosts three responsibilities, each independently interruptible:
 *  1. the BullMQ consumer that executes runs,
 *  2. the outbox dispatcher loop that publishes durably-queued messages,
 *  3. the recovery sweep that expires approvals and reconciles stale attempts.
 *
 * Splitting them into separate deployments is a configuration change (the loops are
 * startup flags), not a code change. For the MVP one process keeps local
 * operations simple.
 *
 * Graceful shutdown: the consumer stops accepting new work and lets the current
 * job finish; the loops stop before the database connection closes. A run that is
 * mid-flight when the process dies is recovered from PostgreSQL on the next start,
 * which is exactly what the recovery sweep exists to prove.
 */
import { loadConfig } from '../config/env.js';
import { buildCore, buildRunServices } from '../container.js';
import { createRunWorker, type QueueConfig } from '../infra/queue/bullmq.js';
import { createLogger, asLoggerPort } from '../infra/logging/logger.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const pinoLogger = createLogger({ level: config.logLevel, service: 'worker' });
  const logger = asLoggerPort(pinoLogger);

  const core = buildCore(config);
  const services = buildRunServices(core);

  const queueConfig: QueueConfig = {
    name: config.redis.queueName,
    prefix: config.redis.queuePrefix,
    redisUrl: config.redis.url,
    attempts: config.redis.attempts,
    backoffMs: config.redis.backoffMs,
  };

  const handler = createRunWorker({
    config: queueConfig,
    logger,
    concurrency: Number(process.env.WORKER_CONCURRENCY ?? 2),
    handler: async (payload) => {
      await services.workflow.executeRun(payload);
    },
  });

  let stopping = false;
  const dispatcherTimer = setInterval(() => {
    if (stopping) return;
    void services.dispatcher.dispatchOnce().catch((error: unknown) => {
      logger.error({ error: error instanceof Error ? error.message : 'unknown' }, 'outbox dispatch cycle failed');
    });
  }, 250);

  const recoveryTimer = setInterval(() => {
    if (stopping) return;
    void services.recovery.runOnce().catch((error: unknown) => {
      logger.error({ error: error instanceof Error ? error.message : 'unknown' }, 'recovery cycle failed');
    });
  }, config.recovery.intervalMs);

  // Run both loops once immediately so a cold start drains any backlog promptly.
  await services.dispatcher.dispatchOnce().catch(() => undefined);
  await services.recovery.runOnce().catch(() => undefined);

  logger.info(
    {
      queue: config.redis.queueName,
      provider: core.llm.name,
      model: core.llm.model,
      attempts: config.redis.attempts,
      recoveryIntervalMs: config.recovery.intervalMs,
    },
    'worker started',
  );

  const shutdown = async (signal: string): Promise<void> => {
    if (stopping) return;
    stopping = true;
    logger.info({ signal }, 'worker shutting down gracefully');
    clearInterval(dispatcherTimer);
    clearInterval(recoveryTimer);
    await handler.close().catch(() => undefined);
    await core.close().catch(() => undefined);
    logger.info({}, 'worker stopped');
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('unhandledRejection', (reason) => {
    logger.error({ error: reason instanceof Error ? reason.message : String(reason) }, 'unhandled rejection in worker');
  });
}

main().catch((error: unknown) => {
  // Startup failures must be loud: print and exit non-zero.
  console.error('worker failed to start:', error instanceof Error ? error.message : error);
  process.exit(1);
});
