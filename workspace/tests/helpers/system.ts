/**
 * End-to-end test harness.
 *
 * This runs the *real* system in-process: the Fastify API, the BullMQ consumer,
 * the outbox dispatcher and the recovery sweep, all against the real PostgreSQL and
 * Redis instances. Tests therefore exercise the deployed code paths — queue
 * redelivery, compare-and-set transitions, unique constraints — rather than a
 * simulation of them.
 *
 * Only two things are substituted, and both are explicitly injected:
 *  * the LLM provider (deterministic mock, with optional failure injection),
 *  * the clock, where a test needs to move approval expiry along.
 */
import type { FastifyInstance } from 'fastify';
import { buildCore, buildRunServices, type CoreContainer, type RunServices } from '../../src/container.js';
import { buildServer } from '../../src/infra/http/server.js';
import { createRunWorker, type QueueConfig, type RunWorkerHandle } from '../../src/infra/queue/bullmq.js';
import { asLoggerPort, createLogger } from '../../src/infra/logging/logger.js';
import { MockLlmProvider, type MockProviderFaults } from '../../src/infra/llm/mock-provider.js';
import { PrismaStore } from '../../src/infra/prisma/store.js';
import { seed } from '../../scripts/seed.js';
import { toRunJob } from '../../src/app/services/outbox-dispatcher.js';
import type { AppConfig } from '../../src/config/env.js';
import type { Clock, LlmProviderPort, RunRecord, TokenUsage } from '../../src/app/ports.js';
import { testConfig } from './env.js';
import { createTestPrisma, resetTestState, truncateAll } from './infra.js';

export interface TestSystem {
  app: FastifyInstance;
  core: CoreContainer;
  services: RunServices;
  config: AppConfig;
  prisma: ReturnType<typeof createTestPrisma>;
  worker: RunWorkerHandle;
  /** Drives one dispatcher cycle synchronously (deterministic tests). */
  dispatch(): Promise<void>;
  /** Runs one recovery cycle synchronously. */
  recover(): Promise<void>;
  stop(): Promise<void>;
  /** Stops only the queue consumer, leaving the API and database untouched. */
  stopWorker(): Promise<void>;
  /** Starts a fresh consumer on the same queue, simulating a worker restart. */
  startWorkerOnly(): Promise<void>;
}

export interface StartSystemOptions {
  faults?: MockProviderFaults;
  llm?: LlmProviderPort;
  clock?: Clock;
  /** Set false to start the BullMQ consumer lazily (used by the duplicate-delivery test). */
  startWorker?: boolean;
  /**
   * Start the outbox dispatcher and recovery sweeps as background loops, mirroring
   * the worker process. Off by default so unit-style tests can drive both cycles
   * deterministically; e2e tests turn them on to exercise the deployed topology.
   */
  startLoops?: boolean;
  configOverrides?: Record<string, string>;
}

export async function startTestSystem(options: StartSystemOptions = {}): Promise<TestSystem> {
  const config = testConfig(options.configOverrides ?? {});
  const logger = asLoggerPort(createLogger({ level: 'silent', service: 'worker' }));
  const llm = options.llm ?? new MockLlmProvider({ faults: options.faults ?? {} });

  const core = buildCore(config, { llm, ...(options.clock ? { clock: options.clock } : {}) }, 'worker');
  const services = buildRunServices(core);
  const server = buildServer({ core, services });
  const prisma = createTestPrisma();

  const queueConfig: QueueConfig = {
    name: config.redis.queueName,
    prefix: config.redis.queuePrefix,
    redisUrl: config.redis.url,
    attempts: config.redis.attempts,
    backoffMs: config.redis.backoffMs,
  };

  let worker =
    options.startWorker === false
      ? ({ worker: null, close: async () => undefined } as unknown as RunWorkerHandle)
      : createRunWorker({
          config: queueConfig,
          logger,
          concurrency: 4,
          handler: async (payload) => {
            await services.workflow.executeRun(payload);
          },
        });

  const timers: NodeJS.Timeout[] = [];
  if (options.startLoops) {
    timers.push(
      setInterval(() => {
        void services.dispatcher.dispatchOnce().catch(() => undefined);
      }, 100),
    );
    timers.push(
      setInterval(() => {
        void services.recovery.runOnce().catch(() => undefined);
      }, 250),
    );
  }

  return {
    app: server.app,
    core,
    services,
    config,
    prisma,
    worker,
    dispatch: async () => {
      await services.dispatcher.dispatchOnce();
    },
    recover: async () => {
      await services.recovery.runOnce();
    },
    stop: async () => {
      for (const timer of timers) clearInterval(timer);
      await worker.close().catch(() => undefined);
      await server.close().catch(() => undefined);
      await core.close().catch(() => undefined);
      await prisma.$disconnect().catch(() => undefined);
    },
    /** Stops only the queue consumer, simulating a worker process that died. */
    stopWorker: async () => {
      await worker.close().catch(() => undefined);
    },
    /** Starts a fresh consumer on the same queue, simulating a worker restart. */
    startWorkerOnly: async () => {
      worker = createRunWorker({
        config: queueConfig,
        logger,
        concurrency: 4,
        handler: async (payload) => {
          await services.workflow.executeRun(payload);
        },
      });
    },
  };
}

/** Truncates fixtures, clears the queue namespace and seeds the synthetic dataset. */
export async function resetAndSeed(system: TestSystem): Promise<void> {
  await resetTestState(system.prisma, system.config.redis.url, system.config.redis.queuePrefix);
  await seed('tenant-demo');
}

export async function clearData(system: TestSystem): Promise<void> {
  await truncateAll(system.prisma);
}

/**
 * Processes every due outbox message synchronously, using the same message→job
 * mapping as the dispatcher. Tests that need deterministic, step-by-step control
 * (rather than "fire the loops and wait") drive the workflow through here.
 */
export async function drainOutbox(system: TestSystem, maxCycles = 12): Promise<number> {
  let processed = 0;
  for (let cycle = 0; cycle < maxCycles; cycle += 1) {
    const batch = await system.core.store.outbox.claimDueBatch(50, new Date());
    if (batch.length === 0) break;
    for (const record of batch) {
      const job = toRunJob(record);
      if (job) await system.services.workflow.executeRun(job);
      await system.core.store.outbox.markDispatched(record.id, new Date());
      processed += 1;
    }
  }
  return processed;
}

/** Creates (or reuses) a user record, mirroring how the dev-token endpoint provisions one. */
export async function createUser(
  system: TestSystem,
  role: 'ANALYST' | 'APPROVER' | 'ADMIN',
  options: { tenantId?: string; email?: string } = {},
): Promise<{ userId: string; tenantId: string; role: 'ANALYST' | 'APPROVER' | 'ADMIN' }> {
  const email = options.email ?? `${role.toLowerCase()}-${Math.random().toString(36).slice(2, 8)}@example.test`;
  const user = await system.core.store.users.upsert({
    tenantId: options.tenantId ?? 'tenant-demo',
    subject: `local:${role.toLowerCase()}:${email}`,
    email,
    name: `${role} test user`,
    role,
  });
  return { userId: user.id, tenantId: user.tenantId, role: user.role };
}

/** Submits a run through the application service (no HTTP) and returns its id. */
export async function submitRunDirect(
  system: TestSystem,
  principal: { userId: string; tenantId: string },
  overrides: Partial<{ task: string; from: string; to: string; idempotencyKey: string }> = {},
): Promise<string> {
  const result = await system.services.runs.submit({
    tenantId: principal.tenantId,
    userId: principal.userId,
    idempotencyKey: overrides.idempotencyKey ?? null,
    request: {
      task: overrides.task ?? 'Analyse Q3 supplier spend and identify refund candidates with supporting evidence.',
      taskType: 'SPEND_ANOMALY_RESEARCH',
      from: overrides.from ?? DEMO_WINDOW.from,
      to: overrides.to ?? DEMO_WINDOW.to,
      currency: 'USD',
    },
  });
  return result.runId;
}

// ---------------------------------------------------------------------------
// Auth helpers
// ---------------------------------------------------------------------------

export interface TestPrincipal {
  token: string;
  userId: string;
  tenantId: string;
  role: 'ANALYST' | 'APPROVER' | 'ADMIN';
}

export async function issueToken(
  system: TestSystem,
  role: 'ANALYST' | 'APPROVER' | 'ADMIN',
  options: { tenantId?: string; email?: string; subject?: string } = {},
): Promise<TestPrincipal> {
  // Subject and email are derived together: within a tenant an email identifies one
  // user, so two subjects cannot share one (this mirrors an IdP-provisioned user).
  const email = options.email ?? `${role.toLowerCase()}@example.test`;
  const subject = options.subject ?? `local:${role.toLowerCase()}:${email}`;
  const response = await system.app.inject({
    method: 'POST',
    url: '/api/auth/dev-token',
    payload: {
      role,
      tenantId: options.tenantId ?? 'tenant-demo',
      email,
      subject,
    },
  });
  if (response.statusCode !== 201) {
    throw new Error(`Failed to issue a dev token: ${response.statusCode} ${response.body}`);
  }
  const body = response.json() as { token: string; user: { userId: string; tenantId: string; role: 'ANALYST' | 'APPROVER' | 'ADMIN' } };
  return { token: body.token, userId: body.user.userId, tenantId: body.user.tenantId, role: body.user.role };
}

export function authHeaders(principal: TestPrincipal, extra: Record<string, string> = {}): Record<string, string> {
  return { authorization: `Bearer ${principal.token}`, ...extra };
}

// ---------------------------------------------------------------------------
// Run helpers
// ---------------------------------------------------------------------------

export const DEMO_WINDOW = { from: '2026-07-01', to: '2026-09-30' };

/** Convenience re-export so tests exercise the production mapping. */
export { toRunJob };

export async function submitRun(
  system: TestSystem,
  principal: TestPrincipal,
  overrides: Partial<{ task: string; from: string; to: string; taskType: string; idempotencyKey: string }> = {},
): Promise<{ statusCode: number; body: { runId?: string; status?: string; idempotentReplay?: boolean; error?: { code: string } } }> {
  const response = await system.app.inject({
    method: 'POST',
    url: '/api/runs',
    headers: authHeaders(principal, overrides.idempotencyKey ? { 'idempotency-key': overrides.idempotencyKey } : {}),
    payload: {
      task: overrides.task ?? 'Analyse Q3 supplier spend and identify refund candidates with supporting evidence.',
      taskType: overrides.taskType ?? 'SPEND_ANOMALY_RESEARCH',
      from: overrides.from ?? DEMO_WINDOW.from,
      to: overrides.to ?? DEMO_WINDOW.to,
      currency: 'USD',
    },
  });
  return { statusCode: response.statusCode, body: response.json() as never };
}

export async function getRun(system: TestSystem, principal: TestPrincipal, runId: string): Promise<{ statusCode: number; body: RunBody }> {
  const response = await system.app.inject({ method: 'GET', url: `/api/runs/${runId}`, headers: authHeaders(principal) });
  return { statusCode: response.statusCode, body: response.json() as RunBody };
}

export interface RunBody {
  runId: string;
  status: RunStatus;
  attemptCount: number;
  result: { report: ResearchReportBody } | null;
  error: { code: string; message: string } | null;
  tokenUsage: TokenUsage | null;
}

export type RunStatus = 'PENDING' | 'RUNNING' | 'REQUIRES_HUMAN_APPROVAL' | 'COMPLETED' | 'FAILED' | 'CANCELLED';

export interface ResearchReportBody {
  findings: Array<{ id: string; ruleId: string; refundEligible: boolean; suggestedRefundMinor: number }>;
  interpretation: { summary: string; highlightedFindingIds: string[]; model: string; provider: string };
  limitations: string[];
  proposalIds: string[];
  settlement?: { operationId: string; status: string; ledgerEntryId: string | null; amountMinor: number; currency: string };
  approval?: { approvalId: string; status: string; proposalId: string };
}

export async function waitForRunStatus(
  system: TestSystem,
  principal: TestPrincipal,
  runId: string,
  statuses: RunStatus[],
  timeoutMs = 30_000,
): Promise<RunBody> {
  const deadline = Date.now() + timeoutMs;
  let last: RunBody | null = null;
  while (Date.now() < deadline) {
    const { body } = await getRun(system, principal, runId);
    last = body;
    if (statuses.includes(body.status)) return body;
    if (body.status === 'FAILED' && !statuses.includes('FAILED')) {
      throw new Error(`Run ${runId} failed while waiting for ${statuses.join('/')}: ${body.error?.code} ${body.error?.message}`);
    }
    // Keep durable messages moving even when the background loop is not running.
    await system.dispatch().catch(() => undefined);
    await new Promise((resolve) => setTimeout(resolve, 75));
  }
  throw new Error(`Timed out waiting for run ${runId} to reach ${statuses.join('/')}; last status ${last?.status ?? 'unknown'}`);
}

export async function fetchRunHistory(system: TestSystem, principal: TestPrincipal, runId: string) {
  const response = await system.app.inject({ method: 'GET', url: `/api/runs/${runId}/history`, headers: authHeaders(principal) });
  return response.json() as {
    proposals: Array<{ proposalId: string; status: string; amountMinor: number; policyOutcome: string }>;
    approvals: Array<{ approvalId: string; status: string; decidedBy: string | null }>;
    settlements: Array<{ operationId: string; status: string; ledgerEntryId: string | null }>;
  };
}

export async function countLedgerEntries(prisma: ReturnType<typeof createTestPrisma>, proposalId?: string): Promise<number> {
  return prisma.ledgerEntry.count(proposalId ? { where: { proposalId } } : undefined);
}

/** Reads the run row directly, for assertions about durable state. */
export async function loadRunRecord(store: Pick<PrismaStore, 'runs'>, runId: string): Promise<RunRecord | null> {
  return store.runs.findById(runId);
}

// ---------------------------------------------------------------------------
// SSE helper
// ---------------------------------------------------------------------------

export interface CollectedStream {
  events: Array<{ id: string; type: string; payload: Record<string, unknown> }>;
  closed: boolean;
  /** Heartbeat comment frames observed (SRS-EVENT-007). */
  heartbeats: number;
  /** Raw response text, for assertions about frame structure. */
  raw: string;
  /** Resolves when the connection ends (server close, abort or error). */
  finished: Promise<void>;
  /** Disconnects the client, leaving the server-side run untouched. */
  abort(): void;
}

/** The Fastify app can only listen once; the address is cached per test module. */
let cachedBaseUrl: string | null = null;

async function ensureListening(system: TestSystem): Promise<string> {
  if (!cachedBaseUrl) {
    const address = await system.app.listen({ host: '127.0.0.1', port: 0 });
    cachedBaseUrl = address.replace('http://0.0.0.0', 'http://127.0.0.1');
  }
  return cachedBaseUrl;
}

/**
 * Opens the SSE endpoint over a real socket and collects events. `app.inject`
 * cannot stream, so this uses `app.listen` on an ephemeral port.
 */
export async function collectSse(
  system: TestSystem,
  principal: TestPrincipal,
  runId: string,
  options: { lastEventId?: string; stopWhenClosed?: boolean } = {},
): Promise<CollectedStream> {
  const baseUrl = await ensureListening(system);
  const url = `${baseUrl}/api/tasks/${runId}/stream`;
  const controller = new AbortController();
  const headers: Record<string, string> = { accept: 'text/event-stream', authorization: `Bearer ${principal.token}` };
  if (options.lastEventId) headers['last-event-id'] = options.lastEventId;

  const response = await fetch(url, { headers, signal: controller.signal });
  if (!response.ok || !response.body) {
    throw new Error(`SSE connection failed with status ${response.status}`);
  }

  const collected = { events: [], closed: false, heartbeats: 0, raw: '' } as unknown as CollectedStream;
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  const finished = (async () => {
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        buffer += chunk;
        collected.raw += chunk;
        for (const line of chunk.split('\n')) {
          if (line.startsWith(': heartbeat')) collected.heartbeats += 1;
        }
        let index = buffer.indexOf('\n\n');
        while (index !== -1) {
          const frame = buffer.slice(0, index);
          buffer = buffer.slice(index + 2);
          index = buffer.indexOf('\n\n');
          const parsed = parseFrame(frame);
          if (parsed) {
            if (parsed.type === 'stream.closed') collected.closed = true;
            else collected.events.push(parsed);
          }
        }
        if (options.stopWhenClosed && collected.closed) {
          controller.abort();
          break;
        }
      }
    } catch {
      // Aborted or closed by the server: expected.
    }
  })();

  return Object.assign(collected, { finished, abort: () => controller.abort() }) as CollectedStream;
}

function parseFrame(frame: string): { id: string; type: string; payload: Record<string, unknown> } | null {
  let id = '';
  let type = 'message';
  const dataLines: string[] = [];
  for (const line of frame.split('\n')) {
    if (line.startsWith(':')) continue;
    if (line.startsWith('id:')) id = line.slice(3).trim();
    else if (line.startsWith('event:')) type = line.slice(6).trim();
    else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
  }
  if (dataLines.length === 0) return null;
  try {
    return { id, type, payload: JSON.parse(dataLines.join('\n')) as Record<string, unknown> };
  } catch {
    return null;
  }
}
