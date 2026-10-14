import { defineConfig } from 'vitest/config';

/**
 * Three separate test projects so the cheap, infrastructure-free unit suite can run
 * anywhere while integration/e2e suites run against the Dockerised Postgres + Redis.
 * Integration and e2e files self-skip (with a printed reason) when infra is absent.
 */
export default defineConfig({
  test: {
    globals: false,
    include: [],
    testTimeout: 30_000,
    hookTimeout: 60_000,
    // Suites touch the same Postgres database and Redis namespace, so files run
    // sequentially; individual files may still parallelise their own cases.
    fileParallelism: false,
    projects: [
      {
        test: {
          name: 'unit',
          environment: 'node',
          include: ['tests/unit/**/*.test.ts'],
        },
      },
      {
        test: {
          name: 'integration',
          environment: 'node',
          include: ['tests/integration/**/*.test.ts'],
          setupFiles: ['tests/setup/integration.setup.ts'],
          testTimeout: 60_000,
          hookTimeout: 120_000,
        },
      },
      {
        test: {
          name: 'e2e',
          environment: 'node',
          include: ['tests/e2e/**/*.test.ts'],
          setupFiles: ['tests/setup/e2e.setup.ts'],
          testTimeout: 120_000,
          hookTimeout: 120_000,
        },
      },
    ],
  },
});
