/**
 * Test environment preparation.
 *
 * Integration and e2e suites run against the dedicated `rfa_test` database and a
 * separate Redis namespace, never the development database. Configuration is
 * built by the same `loadConfig` used in production, so a configuration mistake
 * fails the tests rather than hiding behind a test-only shortcut.
 */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadConfig, type AppConfig } from '../../src/config/env.js';

export const DEFAULT_TEST_DATABASE_URL = 'postgresql://rfa:rfa@127.0.0.1:55432/rfa_test?schema=public';
export const DEFAULT_TEST_REDIS_URL = 'redis://127.0.0.1:56379';

let prepared = false;

export function prepareTestEnv(): void {
  if (prepared) return;
  const envPath = resolve(process.cwd(), '.env');
  if (existsSync(envPath)) {
    try {
      process.loadEnvFile(envPath);
    } catch {
      // Ignore: explicit values below cover anything required.
    }
  }

  process.env.NODE_ENV = 'test';
  process.env.LOG_LEVEL = process.env.TEST_LOG_LEVEL ?? 'silent';
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? DEFAULT_TEST_DATABASE_URL;
  process.env.REDIS_URL = process.env.REDIS_URL ?? DEFAULT_TEST_REDIS_URL;
  process.env.LLM_PROVIDER = 'mock';
  process.env.ENABLE_DEV_TOKENS = 'true';
  process.env.QUEUE_PREFIX = process.env.QUEUE_PREFIX ?? 'rfa-test';
  prepared = true;
}

export function testConfig(overrides: Record<string, string> = {}): AppConfig {
  prepareTestEnv();
  return loadConfig({ ...process.env, ...overrides } as NodeJS.ProcessEnv);
}

export function testDatabaseUrl(): string {
  prepareTestEnv();
  return process.env.DATABASE_URL as string;
}

export function testRedisUrl(): string {
  prepareTestEnv();
  return process.env.REDIS_URL as string;
}
