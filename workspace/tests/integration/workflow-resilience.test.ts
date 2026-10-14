/**
 * Resilience — PR-02/PR-09, SRS-QUEUE-003..006, SRS-STATE-005/006, BR-10.
 *
 * Every case here is a failure mode the business case names explicitly: a flaky
 * model provider, a worker that stops reporting, a queue message that never got
 * published, a model that tries to exceed its authority. The assertions are about
 * durable state — attempts, outbox rows, ledger entries — not about timing.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  createUser,
  drainOutbox,
  loadRunRecord,
  resetAndSeed,
  startTestSystem,
  submitRunDirect,
  type TestSystem,
} from '../helpers/system.js';
import { checkInfra } from '../helpers/infra.js';
import { PrismaStore } from '../../src/infra/prisma/store.js';
import { newId } from '../../src/domain/ids.js';
import type { ToolContext } from '../../src/app/agent/types.js';

const infra = await checkInfra();

describe.skipIf(!infra.ok)(infra.ok ? 'workflow resilience' : `workflow resilience (SKIPPED: ${infra.reason})`, () => {
  let system: TestSystem;
  let store: PrismaStore;
  let analyst: { userId: string; tenantId: string; role: 'ANALYST' };

  beforeAll(async () => {
    system = await startTestSystem();
    store = PrismaStore.create();
  });

  afterAll(async () => {
    await store.disconnect();
    await system.stop();
  });

  beforeEach(async () => {
    await resetAndSeed(system);
    const user = await createUser(system, 'ANALYST');
    analyst = { userId: user.userId, tenantId: user.tenantId, role: 'ANALYST' };
  });

  // -------------------------------------------------------------------------
  // Provider failures
  // -------------------------------------------------------------------------

  it('re-queues a retryable provider failure as a new attempt and fails cleanly once attempts are exhausted', async () => {
    const faulty = await startTestSystem({ faults: { providerErrorTurns: [0] } });
    try {
      await resetAndSeed(faulty);
      const owner = await createUser(faulty, 'ANALYST');
      const runId = await submitRunDirect(faulty, owner);

      // Attempt 1 fails in a retryable way and must be re-queued, not failed.
      const first = await drainOutbox(faulty, 1);
      expect(first).toBeGreaterThan(0);
      const afterFirst = await loadRunRecord(faulty.core.store, runId);
      expect(afterFirst?.status).toBe('PENDING');
      expect(afterFirst?.errorCode).toBe('PROVIDER_ERROR');

      const requeue = await faulty.core.store.steps.listByRun(runId);
      const recoveryStep = requeue.find((step) => step.stepType === 'RECOVERY_REQUEUE' && step.status === 'SUCCEEDED');
      expect(recoveryStep).toBeDefined();
      expect(recoveryStep?.summary).toContain('attempt 2');

      // The retry is durable and carries a fresh attempt id.
      const outboxRows = await faulty.prisma.outboxEvent.findMany({ where: { topic: 'run.execute' }, orderBy: { createdAt: 'asc' } });
      expect(outboxRows.length).toBe(2);
      const secondPayload = outboxRows[1]?.payload as { attemptCount: number; attemptId: string; reason: string };
      expect(secondPayload.attemptCount).toBe(2);
      expect(secondPayload.reason).toBe('RECOVERY');
      expect(secondPayload.attemptId).not.toBe((outboxRows[0]?.payload as { attemptId: string }).attemptId);

      // Attempts are bounded: eventually the run fails with a stable code.
      await drainOutbox(faulty);
      await drainOutbox(faulty);
      const final = await loadRunRecord(faulty.core.store, runId);
      expect(final?.status).toBe('FAILED');
      expect(final?.errorCode).toBe('PROVIDER_ERROR');
      expect(final?.attemptCount).toBeLessThanOrEqual(faulty.config.redis.attempts);
      // A failed run must never have moved money.
      expect(await faulty.prisma.ledgerEntry.count()).toBe(0);
    } finally {
      await faulty.stop();
    }
  });

  it('never retries a non-retryable model contract violation (SRS-QUEUE-004)', async () => {
    // Turns 3 and 4 cover both plan shapes: with and without a refund to propose.
    const faulty = await startTestSystem({ faults: { omitFinalReportTurns: [3, 4] } });
    try {
      await resetAndSeed(faulty);
      const owner = await createUser(faulty, 'ANALYST');
      const runId = await submitRunDirect(faulty, owner);
      await drainOutbox(faulty);

      const run = await loadRunRecord(faulty.core.store, runId);
      expect(run?.status).toBe('FAILED');
      expect(run?.errorCode).toBe('MODEL_OUTPUT_INVALID');
      expect(run?.attemptCount).toBe(1);
      // Exactly one execution attempt was scheduled: no automatic retry.
      expect(await faulty.prisma.outboxEvent.count({ where: { topic: 'run.execute' } })).toBe(1);
    } finally {
      await faulty.stop();
    }
  });

  // -------------------------------------------------------------------------
  // Model misbehaviour
  // -------------------------------------------------------------------------

  it('rejects malformed tool arguments without terminating the attempt', async () => {
    const faulty = await startTestSystem({ faults: { malformedArgsTurns: [0] } });
    try {
      await resetAndSeed(faulty);
      const owner = await createUser(faulty, 'ANALYST');
      const runId = await submitRunDirect(faulty, owner);
      await drainOutbox(faulty);

      const run = await loadRunRecord(faulty.core.store, runId);
      expect(run?.status).toBe('REQUIRES_HUMAN_APPROVAL');
      const rejected = (await faulty.core.store.steps.listByRun(runId)).find((step) => step.errorCode === 'TOOL_ARGUMENT_INVALID');
      expect(rejected).toBeDefined();
      expect(rejected?.stepType).toBe('TOOL_CALL');
      expect(rejected?.status).toBe('FAILED');
    } finally {
      await faulty.stop();
    }
  });

  it('rejects a model attempt to use an unregistered capability and completes the run honestly', async () => {
    const faulty = await startTestSystem({ faults: { unregisteredToolTurns: [1] } });
    try {
      await resetAndSeed(faulty);
      const owner = await createUser(faulty, 'ANALYST');
      const runId = await submitRunDirect(faulty, owner);
      await drainOutbox(faulty);

      const steps = await faulty.core.store.steps.listByRun(runId);
      const rejected = steps.find((step) => step.errorCode === 'TOOL_NOT_REGISTERED');
      expect(rejected).toBeDefined();
      expect(rejected?.payload).toMatchObject({ tool: 'execute_sql' });

      // The refused call changed nothing: still one pending approval, no ledger row.
      const run = await loadRunRecord(faulty.core.store, runId);
      expect(run?.status).toBe('REQUIRES_HUMAN_APPROVAL');
      expect(await faulty.prisma.ledgerEntry.count()).toBe(0);
      expect(run?.result).toBeNull();
    } finally {
      await faulty.stop();
    }
  });

  it('exposes dataset free text to the model as explicitly untrusted data (SRS-AGENT-010)', async () => {
    const context: ToolContext = {
      run: {
        id: newId(),
        tenantId: 'tenant-demo',
        ownerId: analyst.userId,
        taskType: 'SPEND_ANOMALY_RESEARCH',
        status: 'RUNNING',
        request: { task: 'x', taskType: 'SPEND_ANOMALY_RESEARCH', from: '2026-07-01', to: '2026-09-30', currency: 'USD' },
        policyVersion: 'v1',
        version: 1,
        attemptId: 'attempt-1',
        attemptCount: 1,
        heartbeatAt: null,
        tokenUsage: null,
        result: null,
        errorCode: null,
        errorMessage: null,
        idempotencyKeyId: null,
        createdAt: new Date(),
        startedAt: null,
        completedAt: null,
        updatedAt: new Date(),
      },
      attemptId: 'attempt-1',
      store,
      clock: { now: () => new Date() },
      logger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
      cache: { analysis: null, report: null, proposals: [], transactions: new Map() },
      createProposal: async () => {
        throw new Error('not used');
      },
    };

    const registry = system.core.registry;
    const result = await registry.invoke('list_transactions', { from: '2026-07-01', to: '2026-09-30', limit: 50 }, context);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const data = result.data as { transactions: Array<{ description: { trust: string; untrustedContent: string } }> };
    const injected = data.transactions.find((tx) => tx.description.untrustedContent.includes('ignore all previous instructions'));
    expect(injected).toBeDefined();
    // The injection text is returned as data and labelled as such.
    expect(injected?.description.trust).toBe('UNTRUSTED_DATA');
  });

  // -------------------------------------------------------------------------
  // Stale attempts
  // -------------------------------------------------------------------------

  async function createStaleRunningRun(attemptCount: number): Promise<string> {
    const run = await store.runs.insert({
      id: newId(),
      tenantId: 'tenant-demo',
      ownerId: analyst.userId,
      taskType: 'SPEND_ANOMALY_RESEARCH',
      request: { task: 'Stale attempt fixture', taskType: 'SPEND_ANOMALY_RESEARCH', from: '2026-07-01', to: '2026-09-30', currency: 'USD' },
      policyVersion: 'v1',
      idempotencyKeyId: null,
    });
    await store.runs.transition({
      id: run.id,
      expectedVersion: run.version,
      to: 'RUNNING',
      patch: {
        attemptId: `attempt-${attemptCount}`,
        attemptCount,
        heartbeatAt: new Date(Date.now() - 10 * 60 * 1000),
      },
    });
    return run.id;
  }

  it('re-queues an attempt whose worker stopped reporting', async () => {
    const runId = await createStaleRunningRun(1);
    const result = await system.services.recovery.runOnce();
    expect(result.staleRequeued).toBe(1);

    const recovered = await loadRunRecord(store, runId);
    expect(recovered?.status).toBe('PENDING');
    expect(recovered?.attemptId).toBeNull();

    const message = await system.prisma.outboxEvent.findFirst({ where: { topic: 'run.execute' }, orderBy: { createdAt: 'desc' } });
    const payload = message?.payload as { attemptCount: number; reason: string };
    expect(payload.attemptCount).toBe(2);
    expect(payload.reason).toBe('RECOVERY');

    await drainOutbox(system);
    expect((await loadRunRecord(store, runId))?.status).toBe('REQUIRES_HUMAN_APPROVAL');
  });

  it('fails a stale attempt with a stable code once no attempts remain', async () => {
    const runId = await createStaleRunningRun(system.config.redis.attempts);
    const result = await system.services.recovery.runOnce();
    expect(result.staleFailed).toBe(1);

    const run = await loadRunRecord(store, runId);
    expect(run?.status).toBe('FAILED');
    expect(run?.errorCode).toBe('STALE_ATTEMPT_EXHAUSTED');
  });

  it('leaves healthy runs untouched', async () => {
    const runId = await submitRunDirect(system, analyst);
    const result = await system.services.recovery.runOnce();
    expect(result.staleRequeued).toBe(0);
    expect(result.staleFailed).toBe(0);
    expect((await loadRunRecord(store, runId))?.status).toBe('PENDING');
  });

  // -------------------------------------------------------------------------
  // Self-healing outbox
  // -------------------------------------------------------------------------

  it('re-arms a missing resumption command from durable state', async () => {
    const runId = await submitRunDirect(system, analyst);
    await drainOutbox(system);
    const proposal = (await store.proposals.listByRun(runId))[0]!;
    const approval = await store.approvals.findByProposalId(proposal.id);
    const approver = await createUser(system, 'APPROVER');

    await system.services.approvals.decide({
      approvalId: approval!.id,
      decision: 'APPROVE',
      reason: 'approve, then simulate a crash before publication',
      context: { userId: approver.userId, tenantId: approver.tenantId, role: 'APPROVER' },
    });

    // Simulate the crash window between the decision commit and the queue publish.
    await system.prisma.outboxEvent.deleteMany({ where: { topic: 'run.resume' } });
    expect(await system.prisma.outboxEvent.count({ where: { topic: 'run.resume' } })).toBe(0);

    const recovery = await system.services.recovery.runOnce();
    expect(recovery.runsRekeyed).toBeGreaterThanOrEqual(1);

    const rearmed = await system.prisma.outboxEvent.findUnique({ where: { dedupeKey: `resume:proposal:${proposal.id}:approved` } });
    expect(rearmed?.status).toBe('PENDING');

    await drainOutbox(system);
    expect((await loadRunRecord(store, runId))?.status).toBe('COMPLETED');
    expect(await system.prisma.ledgerEntry.count({ where: { proposalId: proposal.id } })).toBe(1);
  });

  // -------------------------------------------------------------------------
  // Queue delivery
  // -------------------------------------------------------------------------

  it('publishes a durable outbox message to the queue exactly once', async () => {
    // A worker-less system on its own queue, so the published job is observable
    // instead of being consumed by this file's worker.
    const producer = await startTestSystem({ startWorker: false, configOverrides: { QUEUE_NAME: 'run-execution-outbox-probe' } });
    try {
      await resetAndSeed(producer);
      const owner = await createUser(producer, 'ANALYST');
      const runId = await submitRunDirect(producer, owner);
      await producer.services.dispatcher.dispatchOnce();

      const message = await producer.prisma.outboxEvent.findFirst({ where: { topic: 'run.execute' } });
      expect(message?.status).toBe('DISPATCHED');
      expect(message?.dispatchedAt).not.toBeNull();

      const counts = await producer.core.queue.counts();
      expect(counts.waiting ?? 0).toBe(1);

      // A second sweep must not publish it again.
      await producer.services.dispatcher.dispatchOnce();
      const after = await producer.core.queue.counts();
      expect(after.waiting ?? 0).toBe(1);

      const run = await loadRunRecord(producer.core.store, runId);
      expect(run?.status).toBe('PENDING');
    } finally {
      await producer.stop();
    }
  });

  it('ignores a duplicate delivery of an attempt that is already running', async () => {
    const runId = await submitRunDirect(system, analyst);
    const message = await system.prisma.outboxEvent.findFirst({ where: { topic: 'run.execute' } });
    const payload = message?.payload as { runId: string; attemptId: string; attemptCount: number; version: number; reason: 'SUBMITTED' };

    // First delivery claims the attempt but never finishes (simulating a worker that
    // is still busy). The run is left RUNNING.
    await system.prisma.run.update({ where: { id: runId }, data: { status: 'RUNNING', attemptId: payload.attemptId, attemptCount: 1 } });

    const outcome = await system.services.workflow.executeRun({ ...payload, reason: 'SUBMITTED' });
    expect(outcome.outcome).toBe('ATTEMPT_IN_FLIGHT');

    const steps = await store.steps.listByRun(runId);
    expect(steps.filter((step) => step.stepType === 'MODEL_TURN')).toHaveLength(0);
    expect((await loadRunRecord(store, runId))?.status).toBe('RUNNING');
  });

  it('ignores a job for a run that reached a terminal state (SRS-STATE-006)', async () => {
    const runId = await submitRunDirect(system, analyst);
    await system.prisma.run.update({ where: { id: runId }, data: { status: 'CANCELLED', completedAt: new Date() } });

    const outcome = await system.services.workflow.executeRun({
      version: 1,
      runId,
      attemptId: 'attempt-late',
      attemptCount: 1,
      reason: 'SUBMITTED',
    });
    expect(outcome.outcome).toBe('TERMINAL_IGNORED');
    const steps = await store.steps.listByRun(runId);
    expect(steps.some((step) => step.stepType === 'RECOVERY_REQUEUE' && step.status === 'SKIPPED')).toBe(true);
    expect(await system.prisma.ledgerEntry.count()).toBe(0);
  });
});
