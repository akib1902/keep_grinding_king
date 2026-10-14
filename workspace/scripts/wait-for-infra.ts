/**
 * Blocks until PostgreSQL and Redis accept connections, or fails with a clear
 * message after a bounded number of attempts. Used by `npm run infra:wait` and by
 * the test setup so a suite never fails with an obscure connection error.
 */
import { Redis } from 'ioredis';
import prismaPkg from '@prisma/client';
import { loadConfig } from '../src/config/env.js';
import { redisConnectionOptions } from '../src/infra/queue/bullmq.js';

const { PrismaClient } = prismaPkg;

const ATTEMPTS = Number(process.env.INFRA_WAIT_ATTEMPTS ?? 30);
const DELAY_MS = Number(process.env.INFRA_WAIT_DELAY_MS ?? 1000);

async function waitForDatabase(url: string): Promise<void> {
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  try {
    for (let attempt = 1; attempt <= ATTEMPTS; attempt += 1) {
      try {
        await prisma.$queryRaw`SELECT 1`;
        return;
      } catch (error) {
        if (attempt === ATTEMPTS) {
          throw new Error(`PostgreSQL unreachable at ${redact(url)}: ${error instanceof Error ? error.message : 'unknown'}`);
        }
        await new Promise((resolve) => setTimeout(resolve, DELAY_MS));
      }
    }
  } finally {
    await prisma.$disconnect().catch(() => undefined);
  }
}

async function waitForRedis(url: string): Promise<void> {
  for (let attempt = 1; attempt <= ATTEMPTS; attempt += 1) {
    const client = new Redis({ ...redisConnectionOptions(url), maxRetriesPerRequest: 1, retryStrategy: () => null, lazyConnect: true });
    try {
      await client.connect();
      await client.ping();
      client.disconnect();
      return;
    } catch (error) {
      client.disconnect();
      if (attempt === ATTEMPTS) {
        throw new Error(`Redis unreachable at ${redact(url)}: ${error instanceof Error ? error.message : 'unknown'}`);
      }
      await new Promise((resolve) => setTimeout(resolve, DELAY_MS));
    }
  }
}

function redact(url: string): string {
  return url.replace(/\/\/[^@]*@/, '//***@');
}

async function main(): Promise<void> {
  const config = loadConfig();
  await waitForDatabase(config.database.url);
  console.log('postgres: ready');
  await waitForRedis(config.redis.url);
  console.log('redis: ready');
}

export { waitForDatabase, waitForRedis };

const invokedDirectly = process.argv[1]?.replace(/\\/g, '/').endsWith('scripts/wait-for-infra.ts') ?? false;
if (invokedDirectly) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
