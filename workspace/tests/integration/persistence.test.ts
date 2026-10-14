/**
 * Persistence guarantees — SRS §5.2/§5.3, SRS-SETTLE-003, SRS-AUDIT-003, SRS §7.2.
 *
 * These cases run against the real PostgreSQL instance. They exist to prove that
 * the guarantees the application relies on are enforced by the database, not just
 * by well-behaved callers: uniqueness, compare-and-set transitions, ordered
 * sequences, positive-money CHECK constraints and an append-only ledger.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaStore } from '../../src/infra/prisma/store.js';
import { seed } from '../../scripts/seed.js';
import { checkInfra, createTestPrisma, truncateAll } from '../helpers/infra.js';
import { newId } from '../../src/domain/ids.js';

const infra = await checkInfra();

describe.skipIf(!infra.ok)(
  infra.ok ? 'persistence guarantees' : `persistence guarantees (SKIPPED: ${infra.reason})`,
  () => {
    let store: PrismaStore;
    let prisma: ReturnType<typeof createTestPrisma>;
    let ownerId: string;

    const TENANT = 'tenant-demo';
    const SUPPLIER = '60000000-0000-4000-8000-000000000001';
    const TRANSACTION = '70000000-0000-4000-8000-000000000020';

    beforeAll(async () => {
      store = PrismaStore.create();
      prisma = createTestPrisma();
    });

    afterAll(async () => {
      await store.disconnect();
      await prisma.$disconnect();
    });

    beforeEach(async () => {
      await truncateAll(prisma);
      await seed(TENANT);
      const user = await store.users.upsert({
        tenantId: TENANT,
        subject: 'local:analyst:persistence@example.test',
        email: 'persistence@example.test',
        name: 'Persistence Analyst',
        role: 'ANALYST',
      });
      ownerId = user.id;
    });

    async function createRun(overrides: { taskType?: string } = {}) {
      return store.runs.insert({
        id: newId(),
        tenantId: TENANT,
        ownerId,
        taskType: overrides.taskType ?? 'SPEND_ANOMALY_RESEARCH',
        request: {
          task: 'Persistence test run',
          taskType: 'SPEND_ANOMALY_RESEARCH',
          from: '2026-07-01',
          to: '2026-09-30',
          currency: 'USD',
        },
        policyVersion: 'v1',
        idempotencyKeyId: null,
      });
    }

    async function createProposal(runId: string, overrides: { amountMinor?: number } = {}) {
      return store.proposals.insert({
        id: newId(),
        tenantId: TENANT,
        runId,
        supplierId: SUPPLIER,
        transactionId: TRANSACTION,
        amountMinor: overrides.amountMinor ?? 245_000,
        currency: 'USD',
        refundableAmountMinor: 245_000,
        justification: 'Duplicate invoice reference identified by ANOM-001.',
        evidence: { findingId: 'ANOM-001:abc', ruleId: 'ANOM-001' },
        status: 'APPROVED',
        reviewedHash: 'hash-persistence-1',
        revision: 1,
        policyVersion: 'v1',
        policyDecision: {
          policyVersion: 'v1',
          subject: {
            amountMinor: overrides.amountMinor ?? 245_000,
            currency: 'USD',
            transactionId: TRANSACTION,
            supplierId: SUPPLIER,
            refundableAmountMinor: 245_000,
            existingRefundMinor: 0,
          },
          outcome: 'REQUIRES_APPROVAL',
          requiresApproval: true,
          denyReasons: [],
          checks: [],
          decisionHash: 'decision-hash-1',
        },
        requiresApproval: true,
      });
    }

    // -------------------------------------------------------------------------
    // Ordering
    // -------------------------------------------------------------------------

    describe('ordered, append-only run history', () => {
      it('assigns monotonic step sequences and tolerates concurrent appends', async () => {
        const run = await createRun();
        await Promise.all(
          Array.from({ length: 8 }, (_, index) =>
            store.steps.append({
              runId: run.id,
              attemptId: 'attempt-1',
              stepType: 'MODEL_TURN',
              status: 'SUCCEEDED',
              summary: `turn ${index}`,
            }),
          ),
        );
        const steps = await store.steps.listByRun(run.id);
        expect(steps).toHaveLength(8);
        expect(steps.map((step) => step.sequence)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
      });

      it('assigns monotonic event sequences and replays only newer events', async () => {
        const run = await createRun();
        for (const type of ['run.accepted', 'run.started', 'run.completed']) {
          await store.events.append({ runId: run.id, eventType: type, payload: { runId: run.id } });
        }
        const all = await store.events.listByRun(run.id, 0, 100);
        expect(all.map((event) => event.sequence)).toEqual([1, 2, 3]);

        const replay = await store.events.listByRun(run.id, 1, 100);
        expect(replay).toHaveLength(2);
        expect(replay[0]?.eventType).toBe('run.started');
        expect(await store.events.maxSequence(run.id)).toBe(3);
      });

      it('counts tool calls per attempt for budget accounting', async () => {
        const run = await createRun();
        await store.steps.append({ runId: run.id, attemptId: 'attempt-1', stepType: 'TOOL_CALL', status: 'SUCCEEDED' });
        await store.steps.append({ runId: run.id, attemptId: 'attempt-1', stepType: 'TOOL_CALL', status: 'FAILED' });
        await store.steps.append({ runId: run.id, attemptId: 'attempt-2', stepType: 'TOOL_CALL', status: 'SUCCEEDED' });
        expect(await store.steps.countToolCalls(run.id, 'attempt-1')).toBe(2);
        expect(await store.steps.countToolCalls(run.id, 'attempt-2')).toBe(1);
      });
    });

    // -------------------------------------------------------------------------
    // Compare-and-set
    // -------------------------------------------------------------------------

    describe('optimistic concurrency control', () => {
      it('rejects a transition based on a stale version (SRS-STATE-004)', async () => {
        const run = await createRun();
        const first = await store.runs.transition({ id: run.id, expectedVersion: run.version, to: 'RUNNING' });
        expect(first?.status).toBe('RUNNING');
        expect(first?.version).toBe(run.version + 1);

        const stale = await store.runs.transition({ id: run.id, expectedVersion: run.version, to: 'COMPLETED' });
        expect(stale).toBeNull();
      });

      it('lets only one of many concurrent claimers win', async () => {
        const run = await createRun();
        const results = await Promise.all(
          Array.from({ length: 5 }, () => store.runs.transition({ id: run.id, expectedVersion: run.version, to: 'RUNNING' })),
        );
        expect(results.filter((result) => result !== null)).toHaveLength(1);
      });

      it('records usage and heartbeat without disturbing the version', async () => {
        const run = await createRun();
        const running = await store.runs.transition({ id: run.id, expectedVersion: run.version, to: 'RUNNING', patch: { attemptId: 'attempt-1' } });
        expect(running).not.toBeNull();
        await store.runs.recordUsage(run.id, 'attempt-1', { promptTokens: 5, completionTokens: 5, totalTokens: 10, modelTurns: 1 }, new Date());
        const after = await store.runs.findById(run.id);
        expect(after?.version).toBe(running?.version);
        expect(after?.tokenUsage?.totalTokens).toBe(10);
      });
    });

    // -------------------------------------------------------------------------
    // Idempotency
    // -------------------------------------------------------------------------

    describe('idempotency keys', () => {
      it('claims a key once and reports the existing record afterwards', async () => {
        const first = await store.idempotency.claim({
          id: newId(),
          scope: 'POST /api/runs',
          key: 'key-1',
          tenantId: TENANT,
          requestHash: 'hash-a',
        });
        expect(first.claimed).toBe(true);

        const second = await store.idempotency.claim({
          id: newId(),
          scope: 'POST /api/runs',
          key: 'key-1',
          tenantId: TENANT,
          requestHash: 'hash-b',
        });
        expect(second.claimed).toBe(false);
        expect(second.record.id).toBe(first.record.id);
        expect(second.record.requestHash).toBe('hash-a');
      });

      it('allows the same key value in a different scope', async () => {
        const a = await store.idempotency.claim({ id: newId(), scope: 'scope-a', key: 'shared', tenantId: TENANT, requestHash: 'h' });
        const b = await store.idempotency.claim({ id: newId(), scope: 'scope-b', key: 'shared', tenantId: TENANT, requestHash: 'h' });
        expect(a.claimed).toBe(true);
        expect(b.claimed).toBe(true);
      });

      it('completes a key with its stored outcome', async () => {
        const claim = await store.idempotency.claim({ id: newId(), scope: 'POST /api/runs', key: 'key-2', tenantId: TENANT, requestHash: 'h' });
        await store.idempotency.complete(claim.record.id, { statusCode: 202, responseBody: { runId: 'run-x' }, resourceId: 'run-x' });
        const replay = await store.idempotency.claim({ id: newId(), scope: 'POST /api/runs', key: 'key-2', tenantId: TENANT, requestHash: 'h' });
        expect(replay.claimed).toBe(false);
        expect(replay.record.status).toBe('COMPLETED');
        expect(replay.record.resourceId).toBe('run-x');
      });
    });

    // -------------------------------------------------------------------------
    // Outbox
    // -------------------------------------------------------------------------

    describe('transactional outbox', () => {
      it('de-duplicates on the business key', async () => {
        const first = await store.outbox.enqueue({ topic: 'run.execute', dedupeKey: 'execute:run:1:attempt:1', payload: { runId: '1' } });
        const second = await store.outbox.enqueue({ topic: 'run.execute', dedupeKey: 'execute:run:1:attempt:1', payload: { runId: '1' } });
        expect(second.id).toBe(first.id);
        expect(await prisma.outboxEvent.count()).toBe(1);
      });

      it('claims a due message once and leases it afterwards', async () => {
        await store.outbox.enqueue({ topic: 'run.execute', dedupeKey: 'k1', payload: { runId: '1', attemptId: 'a1', attemptCount: 1, version: 1 } });
        const first = await store.outbox.claimDueBatch(10, new Date());
        expect(first).toHaveLength(1);
        expect(first[0]?.attempts).toBe(1);

        // The lease pushes available_at forward, so an immediate second sweep finds
        // nothing — this is what stops two dispatchers publishing the same message.
        const second = await store.outbox.claimDueBatch(10, new Date());
        expect(second).toHaveLength(0);
      });

      it('marks a message dispatched and never re-claims it', async () => {
        const record = await store.outbox.enqueue({ topic: 'run.execute', dedupeKey: 'k2', payload: { runId: '2' } });
        await store.outbox.claimDueBatch(10, new Date());
        await store.outbox.markDispatched(record.id, new Date());
        const claimed = await store.outbox.claimDueBatch(10, new Date(Date.now() + 60_000));
        expect(claimed).toHaveLength(0);
      });
    });

    // -------------------------------------------------------------------------
    // Settlement uniqueness and immutability
    // -------------------------------------------------------------------------

    describe('settlement uniqueness and ledger immutability', () => {
      it('rejects a second ledger entry for the same operation id (SRS-SETTLE-003)', async () => {
        const run = await createRun();
        const proposal = await createProposal(run.id);
        const operationId = `op_${newId()}`;

        const insert = () =>
          store.ledger.insert({
            id: newId(),
            tenantId: TENANT,
            operationId,
            proposalId: proposal.id,
            supplierId: SUPPLIER,
            amountMinor: proposal.amountMinor,
            currency: 'USD',
            memo: 'simulated refund',
            entryHash: 'hash',
          });

        await insert();
        await expect(insert()).rejects.toMatchObject({ code: 'P2002' });
        expect(await store.ledger.countByProposal(proposal.id)).toBe(1);
      });

      it('prevents an UPDATE to a ledger entry', async () => {
        const run = await createRun();
        const proposal = await createProposal(run.id);
        const entry = await store.ledger.insert({
          id: newId(),
          tenantId: TENANT,
          operationId: `op_${newId()}`,
          proposalId: proposal.id,
          supplierId: SUPPLIER,
          amountMinor: 1_000,
          currency: 'USD',
          memo: 'immutable entry',
          entryHash: 'hash',
        });

        await expect(prisma.$executeRawUnsafe(`UPDATE ledger_entries SET amount_minor = 999999 WHERE id = $1`, entry.id)).rejects.toThrow(
          /append-only/,
        );
        const reread = await store.ledger.findById(entry.id);
        expect(reread?.amountMinor).toBe(1_000);
      });

      it('prevents a DELETE of a ledger entry', async () => {
        const run = await createRun();
        const proposal = await createProposal(run.id);
        const entry = await store.ledger.insert({
          id: newId(),
          tenantId: TENANT,
          operationId: `op_${newId()}`,
          proposalId: proposal.id,
          supplierId: SUPPLIER,
          amountMinor: 1_000,
          currency: 'USD',
          memo: 'immutable entry',
          entryHash: 'hash',
        });

        await expect(prisma.$executeRawUnsafe(`DELETE FROM ledger_entries WHERE id = $1`, entry.id)).rejects.toThrow(/append-only/);
        expect(await store.ledger.findById(entry.id)).not.toBeNull();
      });
    });

    // -------------------------------------------------------------------------
    // Financial invariants at the database level
    // -------------------------------------------------------------------------

    describe('financial CHECK constraints', () => {
      it('rejects a zero or negative transaction amount', async () => {
        await expect(
          prisma.$executeRawUnsafe(
            `INSERT INTO transactions (id, tenant_id, supplier_id, amount_minor, currency, occurred_at, description, category, status, created_at)
             VALUES (gen_random_uuid(), $1, $2, 0, 'USD', now(), 'zero amount', 'OFFICE', 'POSTED', now())`,
            TENANT,
            SUPPLIER,
          ),
        ).rejects.toThrow(/transactions_amount_positive/);
      });

      it('rejects a negative refundable balance on a proposal', async () => {
        const run = await createRun();
        await expect(
          prisma.$executeRawUnsafe(
            `INSERT INTO refund_proposals (id, tenant_id, run_id, supplier_id, transaction_id, amount_minor, currency,
              refundable_amount_minor, justification, evidence, status, reviewed_hash, revision, policy_version, policy_decision,
              requires_approval, created_at, updated_at)
             VALUES (gen_random_uuid(), $1, $2, $3, $4, 1000, 'USD', -1, 'x', '{}', 'APPROVED', 'h', 1, 'v1', '{}', true, now(), now())`,
            TENANT,
            run.id,
            SUPPLIER,
            TRANSACTION,
          ),
        ).rejects.toThrow(/refund_proposals_refundable_non_negative/);
      });

      it('rejects a negative attempt count on a run', async () => {
        const run = await createRun();
        await expect(prisma.$executeRawUnsafe(`UPDATE runs SET attempt_count = -1 WHERE id = $1`, run.id)).rejects.toThrow(
          /runs_attempt_count_non_negative/,
        );
      });
    });

    // -------------------------------------------------------------------------
    // Financial queries used by the policy engine
    // -------------------------------------------------------------------------

    describe('refund aggregation', () => {
      it('separates in-flight refunds from settled ones', async () => {
        const run = await createRun();
        const proposal = await createProposal(run.id, { amountMinor: 50_000 });
        let sums = await store.financial.sumRefundsForTransaction(TENANT, TRANSACTION);
        expect(sums).toEqual({ activeMinor: 50_000, settledMinor: 0 });

        await store.proposals.transition({ id: proposal.id, from: 'APPROVED', to: 'SETTLED' });
        sums = await store.financial.sumRefundsForTransaction(TENANT, TRANSACTION);
        expect(sums).toEqual({ activeMinor: 0, settledMinor: 50_000 });
      });

      it('counts conflicting refunds for a transaction but can exclude one proposal', async () => {
        const run = await createRun();
        const proposal = await createProposal(run.id);
        expect(await store.proposals.countConflicting(TENANT, TRANSACTION, null)).toBe(1);
        expect(await store.proposals.countConflicting(TENANT, TRANSACTION, proposal.id)).toBe(0);
      });

      it('ignores denied and expired proposals when counting conflicts', async () => {
        const run = await createRun();
        const proposal = await createProposal(run.id);
        await store.proposals.transition({ id: proposal.id, from: 'APPROVED', to: 'CANCELLED' });
        expect(await store.proposals.countConflicting(TENANT, TRANSACTION, null)).toBe(0);
      });
    });

    // -------------------------------------------------------------------------
    // Tenant scoping
    // -------------------------------------------------------------------------

    describe('tenant scoping', () => {
      it('does not return another tenant\'s run, supplier or transaction', async () => {
        const run = await createRun();
        expect(await store.runs.findByIdForTenant(run.id, 'tenant-other')).toBeNull();
        expect(await store.financial.findSupplier('tenant-other', SUPPLIER)).toBeNull();
        expect(await store.financial.findTransaction('tenant-other', TRANSACTION)).toBeNull();
        expect(await store.financial.findTransaction(TENANT, TRANSACTION)).not.toBeNull();
      });

      it('scopes proposal reads to the tenant', async () => {
        const run = await createRun();
        const proposal = await createProposal(run.id);
        expect(await store.proposals.findByIdForTenant(proposal.id, 'tenant-other')).toBeNull();
        expect(await store.proposals.findByIdForTenant(proposal.id, TENANT)).not.toBeNull();
      });
    });
  },
);
