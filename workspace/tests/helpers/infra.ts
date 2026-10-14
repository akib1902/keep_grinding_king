/**
 * Infrastructure helpers for integration and e2e suites.
 *
 * When PostgreSQL or Redis is unavailable the check returns a reason and the suite
 * is skipped *with that reason printed* rather than failing cryptically or — worse
 * — silently reporting a pass. A skipped suite is a reported limitation, never a
 * pass.
 */
import { Redis } from 'ioredis';
import prismaPkg from '@prisma/client';
import { redisConnectionOptions } from '../../src/infra/queue/bullmq.js';
import { prepareTestEnv, testDatabaseUrl, testRedisUrl } from './env.js';

const { PrismaClient } = prismaPkg;

export interface InfraStatus {
  ok: boolean;
  reason: string;
  database: string;
  redis: string;
}

let cached: InfraStatus | null = null;

export async function checkInfra(): Promise<InfraStatus> {
  if (cached) return cached;
  prepareTestEnv();

  const status: InfraStatus = { ok: true, reason: '', database: 'unknown', redis: 'unknown' };

  const prisma = new PrismaClient({ datasources: { db: { url: testDatabaseUrl() } } });
  try {
    await prisma.$queryRaw`SELECT 1`;
    // Confirm the migrations really are applied, not just that the server answers.
    const applied = await prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
      'SELECT COUNT(*)::bigint AS count FROM _prisma_migrations WHERE finished_at IS NOT NULL',
    );
    const count = Number(applied[0]?.count ?? 0);
    if (count === 0) {
      status.ok = false;
      status.reason = 'test database has no applied migrations — run `npm run db:test:prepare`';
      status.database = 'unmigrated';
    } else {
      status.database = `ok (${count} migrations)`;
    }
  } catch (error) {
    status.ok = false;
    status.reason = `PostgreSQL unavailable at ${testDatabaseUrl()}: ${error instanceof Error ? error.message : 'unknown error'} — run \`npm run infra:up && npm run db:test:prepare\``;
    status.database = 'unavailable';
  } finally {
    await prisma.$disconnect().catch(() => undefined);
  }

  const redis = new Redis({ ...redisConnectionOptions(testRedisUrl()), maxRetriesPerRequest: 1, retryStrategy: () => null, lazyConnect: true });
  try {
    await redis.connect();
    await redis.ping();
    status.redis = 'ok';
  } catch (error) {
    status.ok = false;
    status.reason = status.reason
      ? `${status.reason}; Redis also unavailable: ${error instanceof Error ? error.message : 'unknown error'}`
      : `Redis unavailable at ${testRedisUrl()}: ${error instanceof Error ? error.message : 'unknown error'} — run \`npm run infra:up\``;
    status.redis = 'unavailable';
  } finally {
    redis.disconnect();
  }

  cached = status;
  return status;
}

/** Fixture tables, in an order safe for TRUNCATE ... CASCADE. */
const TABLES = [
  'ledger_entries',
  'settlement_operations',
  'approval_requests',
  'refund_proposals',
  'audit_events',
  'run_events',
  'run_steps',
  'outbox_events',
  'idempotency_keys',
  'runs',
  'transactions',
  'suppliers',
  'users',
];

export function createTestPrisma(): InstanceType<typeof PrismaClient> {
  prepareTestEnv();
  return new PrismaClient({ datasources: { db: { url: testDatabaseUrl() } } });
}

/**
 * Empties every fixture table. TRUNCATE is used deliberately: it does not fire the
 * row-level DELETE trigger that protects the ledger, but it does remove the rows,
 * which is what a fresh test fixture needs.
 */
export async function truncateAll(prisma: InstanceType<typeof PrismaClient>): Promise<void> {
  const list = TABLES.map((table) => `"${table}"`).join(', ');
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
}

/** Truncates the test database and removes leftover BullMQ keys. */
export async function resetTestState(prisma: InstanceType<typeof PrismaClient>, redisUrl: string, prefix: string): Promise<void> {
  await truncateAll(prisma);
  const redis = new Redis({ ...redisConnectionOptions(redisUrl), maxRetriesPerRequest: 1, retryStrategy: () => null });
  try {
    const keys = await redis.keys(`${prefix}:*`);
    if (keys.length > 0) await redis.del(...keys);
  } finally {
    redis.disconnect();
  }
}
