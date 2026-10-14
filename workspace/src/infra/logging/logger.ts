/**
 * Structured operational logging — SRS-OBS-001/003/004, PR-12.
 *
 * pino with explicit redaction paths so a credential cannot reach stdout even if
 * someone logs a whole config or request object later. Correlation identifiers
 * (`requestId`, `runId`, `attemptId`) travel in the log context.
 */
import pino, { type Logger } from 'pino';
import type { LoggerPort } from '../../app/ports.js';

export interface LoggerOptions {
  level: string;
  service: 'api' | 'worker' | 'script';
  pretty?: boolean;
}

const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'headers.authorization',
  'headers.cookie',
  'authorization',
  'apiKey',
  'api_key',
  'password',
  'secret',
  'token',
  'jwtSecret',
  'LLM_API_KEY',
  'DATABASE_URL',
  '*.apiKey',
  '*.password',
  '*.secret',
  '*.token',
  'config.auth.jwtSecret',
  'config.llm.apiKey',
  'config.database.url',
];

export function createLogger(options: LoggerOptions): Logger {
  return pino({
    level: options.level,
    base: { service: options.service },
    redact: { paths: REDACT_PATHS, censor: '[REDACTED]' },
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: {
      level: (label) => ({ level: label }),
    },
  });
}

export interface LogContext {
  requestId?: string;
  runId?: string;
  attemptId?: string;
}

/** Wraps a pino logger as the application's `LoggerPort`. */
export function asLoggerPort(logger: Logger): LoggerPort {
  return {
    debug: (obj, msg) => logger.debug(obj, msg),
    info: (obj, msg) => logger.info(obj, msg),
    warn: (obj, msg) => logger.warn(obj, msg),
    error: (obj, msg) => logger.error(obj, msg),
  };
}

export function withContext(logger: LoggerPort, context: LogContext): LoggerPort {
  return {
    debug: (obj, msg) => logger.debug({ ...context, ...obj }, msg),
    info: (obj, msg) => logger.info({ ...context, ...obj }, msg),
    warn: (obj, msg) => logger.warn({ ...context, ...obj }, msg),
    error: (obj, msg) => logger.error({ ...context, ...obj }, msg),
  };
}
