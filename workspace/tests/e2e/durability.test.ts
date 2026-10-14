/**
 * Durability across worker interruptions — BR-07/BR-10, SRS-STATE-005/007,
 * SRS-QUEUE-005, BUS-RULE-05/07.
 *
 * The business acceptance criteria being verified:
 *  * "Workflow state surviving worker restart — demonstrated successfully."
 *  * "Duplicate ledger entries for one operation — 0."
 *
 * Failure is produced the honest way: the queue consumer is stopped (or the run
 * row is left in the state a crash would leave behind), and the system has to
 * recover from PostgreSQL alone.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  authHeaders,
  fetchRunHistory,
  issueToken,
  resetAndSeed,
  startTestSystem,
  submitRun,
  waitForRunStatus,
  type TestPrincipal,
  type TestSystem,
} from '../helpers/system.js';
import { checkInfra } from '../helpers/infra.js';
import { PrismaStore } from '../../src/infra/prisma/store.js';
import { toRunJob } from '../../src/app/services/outbox-dispatcher.js';

const infra = await checkInfra();

describe.skipIf(!infra.ok)(infra.ok ? 'end-to-end: durability and recovery' : `end-to-end: durability (SKIPPED: ${infra.reason})`, () => {
  let system: TestSystem;
  let store: PrismaStore;
  let analyst: TestPrincipal;
  let approver: TestPrincipal;

  beforeAll(async () => {
    system = await startTestSystem({
      startLoops: true,
      configOverrides: {
        QUEUE_NAME: 'run-execution-durability',
        // A short staleness window so the recovery sweep is observable in a test.
        STALE_ATTEMPT_MS: '1000',
        RECOVERY_INTERVAL_MS: '1000',
      },
    });
    store = PrismaStore.create();
  });

  afterAll(async () => {
    await store.disconnect();
    await system.stop();
  });

  beforeEach(async () => {
    await resetAndSeed(system);
    analyst = await issueToken(system, 'ANALYST');
    approver = await issueToken(system, 'APPROVER');
  });

  it('survives a worker restart: the pause, the decision and the settlement all persist', async () => {
    const submitted = await submitRun(system, analyst);
    const runId = submitted.body.runId as string;
    await waitForRunStatus(system, analyst, runId, ['REQUIRES_HUMAN_APPROVAL']);

    // --- the worker process dies ------------------------------------------
    await system.stopWorker();
    const beforeRestart = await store.runs.findById(runId);
    expect(beforeRestart?.status).toBe('REQUIRES_HUMAN_APPROVAL');
    const proposal = (await store.proposals.listByRun(runId))[0]!;
    const approvalId = (await store.approvals.findByProposalId(proposal.id))!.id;

    // The decision is durable and must be recordable with no worker running: a
    // paused run does not need a worker slot (PR-09).
    const decision = await system.app.inject({
      method: 'POST',
      url: `/api/approvals/${approvalId}/decision`,
      headers: authHeaders(approver),
      payload: { decision: 'APPROVE', reason: 'Approved while the worker was stopped.' },
    });
    expect(decision.statusCode).toBe(200);

    // The resumption command is durable even though nothing consumed it yet.
    const resumeRows = await system.prisma.outboxEvent.findMany({ where: { topic: 'run.resume' } });
    expect(resumeRows.length).toBeGreaterThanOrEqual(1);
    const afterDecision = await store.runs.findById(runId);
    expect(afterDecision?.status).toBe('REQUIRES_HUMAN_APPROVAL');

    // --- the worker comes back --------------------------------------------
    await system.startWorkerOnly();
    const completed = await waitForRunStatus(system, analyst, runId, ['COMPLETED'], 40_000);
    expect(completed.result?.report.settlement?.status).toBe('COMMITTED');

    // Exactly one settlement, and the approval that authorised it is recorded.
    expect(await system.prisma.ledgerEntry.count({ where: { proposalId: proposal.id } })).toBe(1);
    const history = await fetchRunHistory(system, analyst, runId);
    expect(history.approvals[0]?.status).toBe('APPROVED');
    expect(history.settlements[0]?.status).toBe('COMMITTED');
  }, 90_000);

  it('recovers an attempt whose worker disappeared without duplicating the approval or the settlement', async () => {
    const submitted = await submitRun(system, analyst);
    const runId = submitted.body.runId as string;
    await waitForRunStatus(system, analyst, runId, ['REQUIRES_HUMAN_APPROVAL']);

    const proposal = (await store.proposals.listByRun(runId))[0]!;
    const approvalId = (await store.approvals.findByProposalId(proposal.id))!.id;

    // Leave the run exactly as a crashed attempt would: RUNNING, with a heartbeat
    // that stopped reporting.
    await system.prisma.run.update({
      where: { id: runId },
      data: {
        status: 'RUNNING',
        attemptId: 'attempt-crashed',
        attemptCount: 2,
        heartbeatAt: new Date(Date.now() - 10_000),
      },
    });

    // The recovery sweep re-queues it; the next attempt must recognise the outcome
    // the interrupted attempt already recorded instead of researching again.
    const deadline = Date.now() + 40_000;
    let recovered = false;
    while (Date.now() < deadline) {
      const run = await store.runs.findById(runId);
      if (run?.status === 'REQUIRES_HUMAN_APPROVAL') {
        const steps = await store.steps.listByRun(runId);
        if (steps.some((step) => step.summary?.includes('Re-established the approval pause'))) {
          recovered = true;
          break;
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    expect(recovered).toBe(true);

    // No duplicate proposal, no extra approval, no money moved.
    expect(await system.prisma.refundProposal.count({ where: { runId } })).toBe(1);
    expect(await system.prisma.approvalRequest.count({ where: { runId } })).toBe(1);
    expect(await store.approvals.findById(approvalId)).not.toBeNull();
    expect(await system.prisma.ledgerEntry.count()).toBe(0);

    // The approval still works after the recovery.
    const decision = await system.app.inject({
      method: 'POST',
      url: `/api/approvals/${approvalId}/decision`,
      headers: authHeaders(approver),
      payload: { decision: 'APPROVE', reason: 'Approved after the attempt was recovered.' },
    });
    expect(decision.statusCode).toBe(200);
    await waitForRunStatus(system, analyst, runId, ['COMPLETED'], 40_000);
    expect(await system.prisma.ledgerEntry.count({ where: { proposalId: proposal.id } })).toBe(1);
  }, 90_000);

  it('completes an interrupted run from its recorded settlement without settling twice', async () => {
    const submitted = await submitRun(system, analyst);
    const runId = submitted.body.runId as string;
    await waitForRunStatus(system, analyst, runId, ['REQUIRES_HUMAN_APPROVAL']);
    const approvalId = (await fetchRunHistory(system, analyst, runId)).approvals[0]!.approvalId;
    await system.app.inject({
      method: 'POST',
      url: `/api/approvals/${approvalId}/decision`,
      headers: authHeaders(approver),
      payload: { decision: 'APPROVE', reason: 'For the interrupted-completion case.' },
    });
    await waitForRunStatus(system, analyst, runId, ['COMPLETED'], 40_000);
    expect(await system.prisma.ledgerEntry.count()).toBe(1);

    // Simulate a crash between the settlement commit and the run completion by
    // rolling the run back to how it looked before that final write.
    // Raw SQL because the JSON columns need database-level NULL, not JSON `null`.
    await system.prisma.$executeRawUnsafe(
      `UPDATE runs SET status = 'PENDING', completed_at = NULL, result = NULL, attempt_id = NULL WHERE id = $1`,
      runId,
    );

    const resumeRow = await system.prisma.outboxEvent.findFirst({ where: { topic: 'run.resume' } });
    const job = toRunJob({
      id: resumeRow!.id,
      topic: 'run.resume',
      payload: resumeRow!.payload as Record<string, unknown>,
      dedupeKey: resumeRow!.dedupeKey,
    })!;
    const outcome = await system.services.workflow.executeRun(job);
    expect(outcome.outcome).toBe('RECOVERED_SETTLED');

    const run = await store.runs.findById(runId);
    expect(run?.status).toBe('COMPLETED');
    expect(run?.result?.report.settlement?.status).toBe('COMMITTED');
    // Still exactly one ledger entry: the recovery resolved to the existing outcome.
    expect(await system.prisma.ledgerEntry.count()).toBe(1);
    expect(await system.prisma.settlementOperation.count()).toBe(1);
  }, 90_000);

  it('re-queues every attempt through the durable outbox rather than relying on queue semantics', async () => {
    const submitted = await submitRun(system, analyst);
    const runId = submitted.body.runId as string;
    await waitForRunStatus(system, analyst, runId, ['REQUIRES_HUMAN_APPROVAL']);

    const messages = await system.prisma.outboxEvent.findMany({ where: { topic: 'run.execute' } });
    // Every execution message is accounted for: dispatched, with its payload intact.
    expect(messages).toHaveLength(1);
    expect(messages[0]?.status).toBe('DISPATCHED');
    expect((messages[0]?.payload as { runId: string }).runId).toBe(runId);
    // Dedupe key is derived from the attempt, so a re-publication cannot double up.
    expect(messages[0]?.dedupeKey).toContain((messages[0]?.payload as { attemptId: string }).attemptId);
  });

  it('offers no route that can mutate a recorded ledger entry', async () => {
    const submitted = await submitRun(system, analyst);
    const runId = submitted.body.runId as string;
    await waitForRunStatus(system, analyst, runId, ['REQUIRES_HUMAN_APPROVAL']);
    const approvalId = (await fetchRunHistory(system, analyst, runId)).approvals[0]!.approvalId;
    await system.app.inject({
      method: 'POST',
      url: `/api/approvals/${approvalId}/decision`,
      headers: authHeaders(approver),
      payload: { decision: 'APPROVE', reason: 'Ledger immutability case.' },
    });
    const completed = await waitForRunStatus(system, analyst, runId, ['COMPLETED'], 40_000);
    const operationId = completed.result?.report.settlement?.operationId as string;

    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE'] as const) {
      const response = await system.app.inject({ method, url: `/api/ledger/operations/${operationId}`, headers: authHeaders(approver) });
      expect(response.statusCode).toBe(404);
    }

    // The entry is still there and unchanged.
    const entry = await store.ledger.findByOperationId(operationId);
    expect(entry).not.toBeNull();
    expect(await system.prisma.ledgerEntry.count()).toBe(1);
  }, 60_000);

  it('cannot see another tenant\'s financial data when researching the same window', async () => {
    // A second tenant with no suppliers or transactions of its own.
    const otherTenantAnalyst = await issueToken(system, 'ANALYST', { email: 'tenant-other@example.test', tenantId: 'tenant-other' });

    const submitted = await submitRun(system, otherTenantAnalyst);
    expect(submitted.statusCode).toBe(202);
    const runId = submitted.body.runId as string;
    const run = await waitForRunStatus(system, otherTenantAnalyst, runId, ['COMPLETED'], 40_000);

    // The same window over the demo tenant's data yields findings; here, the tenant
    // scope leaves nothing to analyse and no refund can be proposed.
    const report = run.result?.report;
    expect(report?.findings).toHaveLength(0);
    expect(report?.proposalIds).toHaveLength(0);
    expect(await system.prisma.refundProposal.count({ where: { tenantId: 'tenant-other' } })).toBe(0);
    expect(await system.prisma.ledgerEntry.count()).toBe(0);
  }, 60_000);
});
