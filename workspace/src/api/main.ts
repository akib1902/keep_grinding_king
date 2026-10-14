/**
 * API process — SRS §10.
 *
 * Serves the documented HTTP surface and the SSE stream. It never executes a run
 * itself: submission writes a run plus an outbox message, and the worker does the
 * rest. That separation is what keeps an HTTP request from being the lifetime
 * boundary of a long-running workflow (PRD §3.3).
 */
import { loadConfig } from '../config/env.js';
import { buildCore, buildRunServices } from '../container.js';
import { createLogger, asLoggerPort } from '../infra/logging/logger.js';
import { buildServer } from '../infra/http/server.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const pinoLogger = createLogger({ level: config.logLevel, service: 'api' });
  const logger = asLoggerPort(pinoLogger);

  const core = buildCore(config);
  const services = buildRunServices(core);
  const server = buildServer({ core, services });

  await server.app.listen({ host: config.api.host, port: config.api.port });

  logger.info(
    {
      host: config.api.host,
      port: config.api.port,
      policyVersion: core.policy.version,
      approvalThresholdMinor: core.policy.approvalThresholdMinor,
      llmProvider: core.llm.name,
      devTokens: config.auth.enableDevTokens,
    },
    'api listening',
  );

  let stopping = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (stopping) return;
    stopping = true;
    logger.info({ signal }, 'api shutting down gracefully');
    await server.close().catch(() => undefined);
    await core.close().catch(() => undefined);
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((error: unknown) => {
  console.error('api failed to start:', error instanceof Error ? error.message : error);
  process.exit(1);
});
