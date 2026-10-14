/**
 * Provisions the dedicated integration/e2e test database.
 *
 * Integration tests never run against the development database: they truncate
 * tables between cases, which would destroy demo data. This script creates
 * `rfa_test` if it does not exist and applies the committed migrations to it, so
 * the test schema is always the same artefact that production migrates.
 */
import { execFileSync } from 'node:child_process';
import prismaPkg from '@prisma/client';
import { loadConfig } from '../src/config/env.js';

const { PrismaClient } = prismaPkg;

function databaseName(url: string): string {
  const parsed = new URL(url);
  return parsed.pathname.replace(/^\//, '');
}

function adminUrlFor(url: string): string {
  const parsed = new URL(url);
  parsed.pathname = '/postgres';
  return parsed.toString();
}

async function main(): Promise<void> {
  const config = loadConfig();
  const testUrl = config.database.testUrl ?? config.database.url;
  const target = databaseName(testUrl);

  const admin = new PrismaClient({ datasources: { db: { url: adminUrlFor(testUrl) } } });
  try {
    const existing = await admin.$queryRawUnsafe<Array<{ datname: string }>>(
      `SELECT datname FROM pg_database WHERE datname = $1`,
      target,
    );
    if (existing.length === 0) {
      // CREATE DATABASE cannot run inside a transaction block; Prisma executes
      // this statement outside one.
      await admin.$executeRawUnsafe(`CREATE DATABASE "${target}"`);
      console.log(`created test database "${target}"`);
    } else {
      console.log(`test database "${target}" already exists`);
    }
  } finally {
    await admin.$disconnect();
  }

  console.log('applying migrations to the test database...');
  execFileSync('npx', ['prisma', 'migrate', 'deploy'], {
    stdio: 'inherit',
    env: { ...process.env, DATABASE_URL: testUrl },
    shell: process.platform === 'win32',
  });
  console.log('test database ready');
}

main().catch((error: unknown) => {
  console.error('prepare-test-db failed:', error instanceof Error ? error.message : error);
  process.exit(1);
});

export { databaseName, adminUrlFor };
