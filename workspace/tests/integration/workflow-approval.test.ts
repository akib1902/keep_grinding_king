/**
 * Approval and settlement workflow — PR-05..PR-08, SRS-APPROVAL, SRS-SETTLE.
 *
 * Runs the real services against real PostgreSQL, driving the workflow
 * step-by-step so each guarantee is asserted on durable state rather than on a
 * timing-sensitive side effect.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  clearData,
  createUser,
  drainOutbox,
  loadRunRecord,
  resetAndSeed,
  startTestSystem,
  submitRunDirect,
  type TestSystem,
} from '../helpers/system.js';
import { checkInfra } from '../helpers/infra.js';
import { deriveOperationId } from '../../src/domain/ids.js';
import { PrismaStore } from '../../src/infra/prisma/store.js';
import { seed } from '../../scripts/seed.js';
import { isAppError } from '../../src/domain/errors.js';

const infra = await checkInfra();

describe.skipIf(!infra.ok)(infra.ok ? 'approval and settlement workflow' : `approval and settlement workflow (SKIPPED: ${infra.reason})`, () => {
  let system: TestSystem;
  let store: PrismaStore;
  let analyst: { userId: string; tenantId: string; role: 'ANALYST' };
  let approver: { userId: string; tenantId: string; role: 'APPROVER' };

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
    const a = await createUser(system, 'ANALYST');
    const b = await createUser(system, 'APPROVER');
    analyst = { userId: a.userId, tenantId: a.tenantId, role: 'ANALYST' };
    approver = { userId: b.userId, tenantId: b.tenantId, role: 'APPROVER' };
  });

  // -------------------------------------------------------------------------
  // Below the threshold: policy authorises, no human needed
  // -------------------------------------------------------------------------

  it('auto-allows and settles a refund at or below the approval threshold', async () => {
    // A controlled dataset: one duplicated invoice of USD 200.00 (2 x 20,000
    // minor units) — below the USD 500 threshold, so policy authorises it.
    await clearData(system);
    await seed('tenant-demo');
    // The fixture tables were truncated, so the run owner must be provisioned again.
    const owner = await createUser(system, 'ANALYST');
    analyst = { userId: owner.userId, tenantId: owner.tenantId, role: 'ANALYST' };
    const supplier = '60000000-0000-4000-8000-000000000001';
    for (const [index, date] of ['2026-07-05T09:00:00.000Z', '2026-07-20T09:00:00.000Z'].entries()) {
      await system.prisma.transaction.create({
        data: {
          id: `80000000-0000-4000-8000-${index.toString().padStart(12, '0')}`,
          tenantId: 'tenant-demo',
          supplierId: supplier,
          amountMinor: 20_000,
          currency: 'USD',
          occurredAt: new Date(date as string),
          invoiceRef: 'INV-SMALL-1',
          description: 'Small duplicated order',
          category: 'OFFICE',
          status: 'POSTED',
        },
      });
    }

    const runId = await submitRunDirect(system, analyst);
    await drainOutbox(system);

    const run = await loadRunRecord(store, runId);
    expect(run?.status).toBe('COMPLETED');

    const proposals = await store.proposals.listByRun(runId);
    expect(proposals).toHaveLength(1);
    expect(proposals[0]?.amountMinor).toBe(20_000);
    expect(proposals[0]?.policyDecision.outcome).toBe('ALLOW');
    expect(proposals[0]?.status).toBe('SETTLED');
    expect(await store.approvals.findByProposalId(proposals[0]!.id)).toBeNull();

    const ledger = await store.ledger.findByOperationId(
      deriveOperationId({
        proposalId: proposals[0]!.id,
        revision: 1,
        supplierId: proposals[0]!.supplierId,
        amountMinor: 20_000,
        currency: 'USD',
      }),
    );
    expect(ledger).not.toBeNull();
    expect(ledger?.amountMinor).toBe(20_000);
    expect(await system.prisma.ledgerEntry.count()).toBe(1);
  });

  // -------------------------------------------------------------------------
  // Above the threshold: pause, decide, settle once
  // -------------------------------------------------------------------------

  it('pauses above the threshold, settles once after approval and completes the run', async () => {
    const runId = await submitRunDirect(system, analyst);
    await drainOutbox(system);

    // --- paused, with no money moved --------------------------------------
    const paused = await loadRunRecord(store, runId);
    expect(paused?.status).toBe('REQUIRES_HUMAN_APPROVAL');
    expect(await system.prisma.ledgerEntry.count()).toBe(0);

    const proposals = await store.proposals.listByRun(runId);
    expect(proposals).toHaveLength(1);
    const proposal = proposals[0]!;
    expect(proposal.status).toBe('REQUIRES_APPROVAL');
    expect(proposal.policyDecision.outcome).toBe('REQUIRES_APPROVAL');
    expect(proposal.amountMinor).toBeGreaterThan(50_000);

    const approval = await store.approvals.findByProposalId(proposal.id);
    expect(approval?.status).toBe('PENDING');
    expect(approval?.proposalHash).toBe(proposal.reviewedHash);
    // The reviewer sees exactly what they are authorising.
    expect(approval?.reviewedSnapshot).toMatchObject({
      proposalId: proposal.id,
      amountMinor: proposal.amountMinor,
      currency: proposal.currency,
      revision: proposal.revision,
    });

    // --- decide -----------------------------------------------------------
    const decision = await system.services.approvals.decide({
      approvalId: approval!.id,
      decision: 'APPROVE',
      reason: 'Evidence reviewed: duplicated invoice confirmed with the supplier.',
      context: { userId: approver.userId, tenantId: approver.tenantId, role: 'APPROVER' },
    });
    expect(decision.status).toBe('APPROVED');

    // The resumption command is durable and written with the decision.
    const resumeMessage = await system.prisma.outboxEvent.findUnique({
      where: { dedupeKey: `resume:proposal:${proposal.id}:approved` },
    });
    expect(resumeMessage?.status).toBe('PENDING');

    // --- resume and settle -------------------------------------------------
    await drainOutbox(system);
    const completed = await loadRunRecord(store, runId);
    expect(completed?.status).toBe('COMPLETED');
    expect(completed?.result?.report.settlement?.status).toBe('COMMITTED');
    expect(completed?.result?.report.approval?.status).toBe('APPROVED');

    const settledProposal = await store.proposals.findById(proposal.id);
    expect(settledProposal?.status).toBe('SETTLED');

    const operationId = completed?.result?.report.settlement?.operationId as string;
    expect(await system.prisma.ledgerEntry.count()).toBe(1);
    const ledgerEntry = await store.ledger.findByOperationId(operationId);
    expect(ledgerEntry?.proposalId).toBe(proposal.id);
    expect(ledgerEntry?.memo).toContain('Simulated refund');

    // History is inspectable end to end.
    const steps = await store.steps.listByRun(runId);
    const stepTypes = steps.map((step) => step.stepType);
    expect(stepTypes).toContain('APPROVAL_REQUIRED');
    expect(stepTypes).toContain('APPROVAL_DECIDED');
    expect(stepTypes).toContain('SETTLEMENT');
    expect(stepTypes).toContain('RESEARCH_REPORT');

    const auditActions = (await store.audit.listByRun(runId, 100)).map((record) => record.action);
    expect(auditActions).toEqual(
      expect.arrayContaining(['run.submitted', 'refund_proposal.created', 'approval.requested', 'approval.approved', 'settlement.committed']),
    );
  });

  it('completes a run without settling when the proposal is rejected', async () => {
    const runId = await submitRunDirect(system, analyst);
    await drainOutbox(system);
    const proposal = (await store.proposals.listByRun(runId))[0]!;
    const approval = await store.approvals.findByProposalId(proposal.id);

    await system.services.approvals.decide({
      approvalId: approval!.id,
      decision: 'REJECT',
      reason: 'Supplier confirmed the second invoice was a legitimate resend.',
      context: { userId: approver.userId, tenantId: approver.tenantId, role: 'APPROVER' },
    });
    await drainOutbox(system);

    const run = await loadRunRecord(store, runId);
    // A rejected proposal is not a successful run-with-refund, and it is not a
    // failed run either: the research completed and records the outcome.
    expect(run?.status).toBe('COMPLETED');
    expect(run?.result?.report.approval?.status).toBe('REJECTED');
    expect(run?.result?.report.settlement).toBeUndefined();
    expect(await system.prisma.ledgerEntry.count()).toBe(0);
    expect((await store.proposals.findById(proposal.id))?.status).toBe('REJECTED');
  });

  it('does not settle an expired approval and completes the run explicitly', async () => {
    let now = new Date('2026-10-14T10:00:00.000Z');
    const clocked = await startTestSystem({ clock: { now: () => now } });
    try {
      await resetAndSeed(clocked);
      const localAnalyst = await createUser(clocked, 'ANALYST');
      const runId = await submitRunDirect(clocked, localAnalyst);
      await drainOutbox(clocked);
      expect((await loadRunRecord(clocked.core.store, runId))?.status).toBe('REQUIRES_HUMAN_APPROVAL');

      const proposal = (await clocked.core.store.proposals.listByRun(runId))[0]!;
      const approval = await clocked.core.store.approvals.findByProposalId(proposal.id);
      expect(approval?.status).toBe('PENDING');

      // Move past the configured approval TTL and sweep.
      now = new Date(now.getTime() + 3 * 60 * 60 * 1000);
      const recovery = await clocked.services.recovery.runOnce();
      expect(recovery.approvalsExpired).toBeGreaterThanOrEqual(1);

      expect((await clocked.core.store.approvals.findByProposalId(proposal.id))?.status).toBe('EXPIRED');
      expect((await clocked.core.store.proposals.findById(proposal.id))?.status).toBe('EXPIRED');

      // A late decision is refused rather than silently accepted.
      await expect(
        clocked.services.approvals.decide({
          approvalId: approval!.id,
          decision: 'APPROVE',
          reason: 'too late',
          context: { userId: (await createUser(clocked, 'APPROVER')).userId, tenantId: 'tenant-demo', role: 'APPROVER' },
        }),
      ).rejects.toMatchObject({ code: 'APPROVAL_NOT_PENDING' });

      await drainOutbox(clocked);
      const run = await loadRunRecord(clocked.core.store, runId);
      expect(run?.status).toBe('COMPLETED');
      expect(run?.result?.report.approval?.status).toBe('EXPIRED');
      // Expiry is never interpreted as a settlement.
      expect(await clocked.prisma.ledgerEntry.count()).toBe(0);
    } finally {
      await clocked.stop();
    }
  });

  // -------------------------------------------------------------------------
  // Decision integrity
  // -------------------------------------------------------------------------

  it('refuses a stale approval once the reviewed proposal has changed (SRS-POLICY-009)', async () => {
    const runId = await submitRunDirect(system, analyst);
    await drainOutbox(system);
    const proposal = (await store.proposals.listByRun(runId))[0]!;
    const approval = await store.approvals.findByProposalId(proposal.id);

    // Simulate a re-validation that rewrites the reviewed content.
    const revised = await store.proposals.revise({
      id: proposal.id,
      expectedRevision: proposal.revision,
      patch: { amountMinor: 1_000, reviewedHash: 'hash-after-revision' },
    });
    expect(revised?.revision).toBe(proposal.revision + 1);

    await expect(
      system.services.approvals.decide({
        approvalId: approval!.id,
        decision: 'APPROVE',
        reason: 'stale',
        context: { userId: approver.userId, tenantId: approver.tenantId, role: 'APPROVER' },
      }),
    ).rejects.toMatchObject({ code: 'APPROVAL_HASH_MISMATCH' });

    // The approval is still pending: nothing was consumed by the rejected call.
    expect((await store.approvals.findById(approval!.id))?.status).toBe('PENDING');
    expect(await system.prisma.ledgerEntry.count()).toBe(0);
  });

  it('allows exactly one final decision under concurrent requests (SRS-APPROVAL-004)', async () => {
    const runId = await submitRunDirect(system, analyst);
    await drainOutbox(system);
    const proposal = (await store.proposals.listByRun(runId))[0]!;
    const approval = await store.approvals.findByProposalId(proposal.id);
    const secondApprover = await createUser(system, 'APPROVER');

    const results = await Promise.allSettled([
      system.services.approvals.decide({
        approvalId: approval!.id,
        decision: 'APPROVE',
        reason: 'first',
        context: { userId: approver.userId, tenantId: approver.tenantId, role: 'APPROVER' },
      }),
      system.services.approvals.decide({
        approvalId: approval!.id,
        decision: 'REJECT',
        reason: 'second',
        context: { userId: secondApprover.userId, tenantId: secondApprover.tenantId, role: 'APPROVER' },
      }),
    ]);

    const fulfilled = results.filter((result) => result.status === 'fulfilled');
    expect(fulfilled).toHaveLength(1);
    const rejected = results.filter((result) => result.status === 'rejected');
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toSatisfy((error: unknown) =>
      isAppError(error) && ['APPROVAL_NOT_PENDING', 'CONCURRENT_MODIFICATION'].includes(error.code),
    );

    const finalStatus = (await store.approvals.findById(approval!.id))?.status;
    expect(['APPROVED', 'REJECTED']).toContain(finalStatus);
    await drainOutbox(system);
    expect(await system.prisma.ledgerEntry.count()).toBeLessThanOrEqual(1);
  });

  it('refuses a repeated decision on an already-decided approval', async () => {
    const runId = await submitRunDirect(system, analyst);
    await drainOutbox(system);
    const proposal = (await store.proposals.listByRun(runId))[0]!;
    const approval = await store.approvals.findByProposalId(proposal.id);

    await system.services.approvals.decide({
      approvalId: approval!.id,
      decision: 'APPROVE',
      reason: 'first decision',
      context: { userId: approver.userId, tenantId: approver.tenantId, role: 'APPROVER' },
    });

    await expect(
      system.services.approvals.decide({
        approvalId: approval!.id,
        decision: 'REJECT',
        reason: 'changed my mind',
        context: { userId: approver.userId, tenantId: approver.tenantId, role: 'APPROVER' },
      }),
    ).rejects.toMatchObject({ code: 'APPROVAL_NOT_PENDING' });

    await drainOutbox(system);
    expect(await system.prisma.ledgerEntry.count()).toBe(1);
    expect((await store.proposals.findById(proposal.id))?.status).toBe('SETTLED');
  });

  // -------------------------------------------------------------------------
  // Settlement idempotency and refusal
  // -------------------------------------------------------------------------

  it('creates exactly one ledger entry when settlement runs concurrently (SRS-SETTLE-005)', async () => {
    const runId = await submitRunDirect(system, analyst);
    await drainOutbox(system);
    const proposal = (await store.proposals.listByRun(runId))[0]!;
    const approval = await store.approvals.findByProposalId(proposal.id);
    await system.services.approvals.decide({
      approvalId: approval!.id,
      decision: 'APPROVE',
      reason: 'approved for the concurrency check',
      context: { userId: approver.userId, tenantId: approver.tenantId, role: 'APPROVER' },
    });

    const operationId = deriveOperationId({
      proposalId: proposal.id,
      revision: proposal.revision,
      supplierId: proposal.supplierId,
      amountMinor: proposal.amountMinor,
      currency: proposal.currency,
    });

    const results = await Promise.allSettled(
      Array.from({ length: 5 }, () => system.services.settlements.settle({ proposalId: proposal.id, operationId })),
    );

    const settled = results.filter((result) => result.status === 'fulfilled').map((result) => (result as PromiseFulfilledResult<{ status: string }>).value);
    expect(settled.length).toBeGreaterThanOrEqual(1);
    expect(await system.prisma.ledgerEntry.count({ where: { proposalId: proposal.id } })).toBe(1);
    expect(await system.prisma.settlementOperation.count({ where: { proposalId: proposal.id } })).toBe(1);
  });

  it('refuses to settle a proposal that policy still denies', async () => {
    const runId = await submitRunDirect(system, analyst);
    await drainOutbox(system);
    const proposal = (await store.proposals.listByRun(runId))[0]!;
    const approval = await store.approvals.findByProposalId(proposal.id);
    await system.services.approvals.decide({
      approvalId: approval!.id,
      decision: 'APPROVE',
      reason: 'approved, then the underlying data changes',
      context: { userId: approver.userId, tenantId: approver.tenantId, role: 'APPROVER' },
    });

    // The source transaction is later found to be refunded: re-validation at
    // settlement time must refuse even though an approval exists.
    await system.prisma.transaction.update({ where: { id: proposal.transactionId }, data: { status: 'REFUNDED' } });
    await system.prisma.refundProposal.update({ where: { id: proposal.id }, data: { status: 'APPROVED' } });

    const result = await system.services.settlements.settle({
      proposalId: proposal.id,
      operationId: deriveOperationId({
        proposalId: proposal.id,
        revision: proposal.revision,
        supplierId: proposal.supplierId,
        amountMinor: proposal.amountMinor,
        currency: proposal.currency,
      }),
    });
    expect(result.status).toBe('REJECTED');
    expect(await system.prisma.ledgerEntry.count()).toBe(0);
  });

  it('completes a run with a single ledger entry even if the completion job runs three times', async () => {
    const runId = await submitRunDirect(system, analyst);
    await drainOutbox(system);
    const proposal = (await store.proposals.listByRun(runId))[0]!;
    const approval = await store.approvals.findByProposalId(proposal.id);
    await system.services.approvals.decide({
      approvalId: approval!.id,
      decision: 'APPROVE',
      reason: 'duplicate-delivery check',
      context: { userId: approver.userId, tenantId: approver.tenantId, role: 'APPROVER' },
    });

    const resumeRecord = await system.prisma.outboxEvent.findUnique({ where: { dedupeKey: `resume:proposal:${proposal.id}:approved` } });
    const { toRunJob } = await import('../../src/app/services/outbox-dispatcher.js');
    const job = toRunJob({
      id: resumeRecord!.id,
      topic: resumeRecord!.topic,
      payload: resumeRecord!.payload as Record<string, unknown>,
      dedupeKey: resumeRecord!.dedupeKey,
    })!;

    for (let attempt = 0; attempt < 3; attempt += 1) {
      await system.services.workflow.executeRun(job);
    }

    expect(await system.prisma.ledgerEntry.count({ where: { proposalId: proposal.id } })).toBe(1);
    expect((await loadRunRecord(store, runId))?.status).toBe('COMPLETED');
    const skipped = (await store.steps.listByRun(runId)).filter(
      (step) => step.stepType === 'RECOVERY_REQUEUE' && step.status === 'SKIPPED',
    );
    expect(skipped.length).toBeGreaterThanOrEqual(1);
  });
});
