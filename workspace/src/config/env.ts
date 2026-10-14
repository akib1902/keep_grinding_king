/**
 * Environment configuration.
 *
 * Loaded once, validated with Zod, and exported as a frozen object. Anything
 * missing or malformed fails fast at process start rather than at 3am inside a
 * worker. `.env` is read only when present; real deployments use process env.
 */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';

function loadDotEnv(): void {
  const envPath = resolve(process.cwd(), '.env');
  if (!existsSync(envPath)) return;
  try {
    // Node >= 20.6 built-in; avoids an extra dependency.
    process.loadEnvFile(envPath);
  } catch {
    // A malformed .env must not crash the process before configuration is read;
    // validation below reports anything genuinely required that is missing.
  }
}

loadDotEnv();

const BooleanFromString = z
  .union([z.boolean(), z.string()])
  .transform((value) => (typeof value === 'boolean' ? value : ['1', 'true', 'yes', 'on'].includes(value.toLowerCase())));

const RawSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

  API_HOST: z.string().default('127.0.0.1'),
  API_PORT: z.coerce.number().int().positive().default(3100),
  APP_ORIGIN: z.string().url().default('http://127.0.0.1:3100'),
  CORS_ORIGINS: z.string().default(''),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required.'),
  TEST_DATABASE_URL: z.string().optional(),

  REDIS_URL: z.string().min(1, 'REDIS_URL is required.'),
  QUEUE_PREFIX: z.string().default('rfa'),
  QUEUE_NAME: z.string().default('run-execution'),
  QUEUE_ATTEMPTS: z.coerce.number().int().min(1).max(10).default(3),
  QUEUE_BACKOFF_MS: z.coerce.number().int().min(0).default(1000),

  JWT_SECRET: z.string().min(16, 'JWT_SECRET must be at least 16 characters.'),
  JWT_ISSUER: z.string().default('resilient-financial-agent'),
  JWT_AUDIENCE: z.string().default('resilient-financial-agent-api'),
  ENABLE_DEV_TOKENS: BooleanFromString.default(false),

  AGENT_MAX_TOOL_CALLS: z.coerce.number().int().min(1).max(50).default(6),
  AGENT_DEADLINE_MS: z.coerce.number().int().min(100).default(30_000),
  AGENT_MAX_MODEL_RETRIES: z.coerce.number().int().min(0).max(10).default(2),
  AGENT_TOKEN_BUDGET: z.coerce.number().int().min(100).default(24_000),

  LLM_PROVIDER: z.enum(['mock', 'openai-compatible']).default('mock'),
  LLM_MODEL: z.string().default('unset'),
  LLM_BASE_URL: z.string().optional(),
  LLM_API_KEY: z.string().optional(),

  POLICY_APPROVAL_THRESHOLD_MINOR: z.coerce.number().int().positive().default(50_000),
  POLICY_CURRENCY: z.string().default('USD'),
  POLICY_VERSION: z.string().default('v1'),

  APPROVAL_TTL_SECONDS: z.coerce.number().int().min(30).default(3600),

  RECOVERY_INTERVAL_MS: z.coerce.number().int().min(1000).default(30_000),
  STALE_ATTEMPT_MS: z.coerce.number().int().min(1000).default(60_000),
});

export interface AppConfig {
  env: 'development' | 'test' | 'production';
  isProduction: boolean;
  logLevel: z.infer<typeof RawSchema>['LOG_LEVEL'];
  api: { host: string; port: number; appOrigin: string; corsOrigins: string[] };
  database: { url: string; testUrl: string | undefined };
  redis: { url: string; queuePrefix: string; queueName: string; attempts: number; backoffMs: number };
  auth: { jwtSecret: string; issuer: string; audience: string; enableDevTokens: boolean };
  agent: { maxToolCalls: number; deadlineMs: number; maxModelRetries: number; tokenBudget: number };
  llm: { provider: 'mock' | 'openai-compatible'; model: string; baseUrl: string | undefined; apiKey: string | undefined };
  policy: { version: string; approvalThresholdMinor: number; currency: string };
  approval: { ttlSeconds: number };
  recovery: { intervalMs: number; staleAttemptMs: number };
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = RawSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ');
    throw new Error(`Invalid environment configuration — ${issues}`);
  }
  const raw = parsed.data;

  if (raw.NODE_ENV === 'production') {
    if (raw.ENABLE_DEV_TOKENS) throw new Error('ENABLE_DEV_TOKENS must be false in production.');
    if (raw.JWT_SECRET.startsWith('local-dev-only')) throw new Error('JWT_SECRET must be replaced in production.');
  }

  return Object.freeze({
    env: raw.NODE_ENV,
    isProduction: raw.NODE_ENV === 'production',
    logLevel: raw.LOG_LEVEL,
    api: {
      host: raw.API_HOST,
      port: raw.API_PORT,
      appOrigin: raw.APP_ORIGIN,
      corsOrigins: raw.CORS_ORIGINS.split(',')
        .map((origin) => origin.trim())
        .filter((origin) => origin.length > 0),
    },
    database: { url: raw.DATABASE_URL, testUrl: raw.TEST_DATABASE_URL },
    redis: {
      url: raw.REDIS_URL,
      queuePrefix: raw.QUEUE_PREFIX,
      queueName: raw.QUEUE_NAME,
      attempts: raw.QUEUE_ATTEMPTS,
      backoffMs: raw.QUEUE_BACKOFF_MS,
    },
    auth: {
      jwtSecret: raw.JWT_SECRET,
      issuer: raw.JWT_ISSUER,
      audience: raw.JWT_AUDIENCE,
      enableDevTokens: raw.ENABLE_DEV_TOKENS,
    },
    agent: {
      maxToolCalls: raw.AGENT_MAX_TOOL_CALLS,
      deadlineMs: raw.AGENT_DEADLINE_MS,
      maxModelRetries: raw.AGENT_MAX_MODEL_RETRIES,
      tokenBudget: raw.AGENT_TOKEN_BUDGET,
    },
    llm: {
      provider: raw.LLM_PROVIDER,
      model: raw.LLM_MODEL,
      baseUrl: raw.LLM_BASE_URL,
      apiKey: raw.LLM_API_KEY,
    },
    policy: {
      version: raw.POLICY_VERSION,
      approvalThresholdMinor: raw.POLICY_APPROVAL_THRESHOLD_MINOR,
      currency: raw.POLICY_CURRENCY,
    },
    approval: { ttlSeconds: raw.APPROVAL_TTL_SECONDS },
    recovery: { intervalMs: raw.RECOVERY_INTERVAL_MS, staleAttemptMs: raw.STALE_ATTEMPT_MS },
  });
}

/** Configuration used by tests: same validation, test defaults. */
export function loadTestConfig(overrides: Record<string, string> = {}): AppConfig {
  return loadConfig({
    ...process.env,
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    DATABASE_URL: process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? '',
    ENABLE_DEV_TOKENS: 'true',
    LLM_PROVIDER: 'mock',
    ...overrides,
  } as NodeJS.ProcessEnv);
}
