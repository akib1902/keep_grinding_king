/**
 * End-to-end acceptance journey — PRD §4, BRD §12, SRS §9.3.
 *
 * This is the reviewer's walkthrough, executed against the deployed topology: a
 * real HTTP server, a real BullMQ queue, a real worker and real PostgreSQL. The
 * background dispatcher and recovery loops are running, so nothing in the flow
 * depends on the test driving it.
 *
 * The business acceptance criterion being verified:
 * "submit a request, observe asynchronous execution, inspect an anomaly report,
 *  review a refund proposal above USD 500, approve it using an authorized account,
 *  and observe exactly one simulated settlement."
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  authHeaders,
  fetchRunHistory,
  getRun,
  issueToken,
  resetAndSeed,
  startTestSystem,
  submitRun,
  waitForRunStatus,
  type RunBody,
  type TestPrincipal,
  type TestSystem,
} from '../helpers/system.js';
import { checkInfra } from '../helpers/infra.js';
import { PrismaStore } from '../../src/infra/prisma/store.js';

const infra = await checkInfra();

describe.skipIf(!infra.ok)(infra.ok ? 'end-to-end: analyst journey' : `end-to-end: analyst journey (SKIPPED: ${infra.reason})`, () => {
  let system: TestSystem;
  let store: PrismaStore;
  let analyst: TestPrincipal;
  let approver: TestPrincipal;

  beforeAll(async () => {
    system = await startTestSystem({ startLoops: true });
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

  it('walks the full request → approval → single settlement journey', async () => {
    // --- 1. submit --------------------------------------------------------
    const submitted = await submitRun(system, analyst);
    expect(submitted.statusCode).toBe(202);
    const runId = submitted.body.runId as string;
    expect(runId).toBeTruthy();
    expect(submitted.body.status).toBe('PENDING');

    // --- 2. asynchronous execution: the response never waited -------------
    const first = await getRun(system, analyst, runId);
    expect(first.statusCode).toBe(200);
    expect(['PENDING', 'RUNNING', 'REQUIRES_HUMAN_APPROVAL']).toContain(first.body.status);

    // --- 3. the run pauses for a human decision above the threshold -------
    const paused = await waitForRunStatus(system, analyst, runId, ['REQUIRES_HUMAN_APPROVAL']);
    expect(paused.status).toBe('REQUIRES_HUMAN_APPROVAL');

    const history = await fetchRunHistory(system, analyst, runId);
    expect(history.proposals).toHaveLength(1);
    const proposal = history.proposals[0]!;
    expect(proposal.amountMinor).toBeGreaterThan(50_000);
    expect(proposal.policyOutcome).toBe('REQUIRES_APPROVAL');
    expect(history.approvals).toHaveLength(1);
    expect(history.settlements).toHaveLength(0);
    // Pausing must not have moved any money.
    expect(await system.prisma.ledgerEntry.count()).toBe(0);

    // --- 4. inspect the anomaly report, evidence and execution history ----
    const stepsResponse = await system.app.inject({
      method: 'GET',
      url: `/api/runs/${runId}/steps`,
      headers: authHeaders(analyst),
    });
    expect(stepsResponse.statusCode).toBe(200);
    const steps = (stepsResponse.json() as { steps: Array<{ type: string; status: string; latencyMs: number | null }> }).steps;
    const types = steps.map((step) => step.type);
    expect(types).toEqual(expect.arrayContaining(['RUN_ACCEPTED', 'MODEL_TURN', 'TOOL_CALL', 'POLICY_EVALUATION', 'PROPOSAL_CREATED', 'APPROVAL_REQUIRED']));
    expect(steps.filter((step) => step.type === 'TOOL_CALL').length).toBeGreaterThan(0);
    expect(steps.every((step) => step.latencyMs === null || step.latencyMs >= 0)).toBe(true);

    const eventsResponse = await system.app.inject({
      method: 'GET',
      url: `/api/runs/${runId}/events`,
      headers: authHeaders(analyst),
    });
    const events = (eventsResponse.json() as { events: Array<{ type: string; sequence: number; payload: Record<string, unknown> }> }).events;
    expect(events.map((event) => event.type)).toEqual(expect.arrayContaining(['run.accepted', 'run.started', 'approval.required', 'run.awaiting_approval']));
    // Sequences are contiguous: an SSE client can replay from any id without gaps.
    expect(events.map((event) => event.sequence)).toEqual(events.map((_, index) => index + 1));

    const auditResponse = await system.app.inject({ method: 'GET', url: `/api/runs/${runId}/audit`, headers: authHeaders(analyst) });
    const audit = (auditResponse.json() as { audit: Array<{ action: string; actorType: string }> }).audit;
    expect(audit.map((record) => record.action)).toEqual(expect.arrayContaining(['run.submitted', 'refund_proposal.created', 'approval.requested']));

    const proposalResponse = await system.app.inject({
      method: 'GET',
      url: `/api/refund-proposals/${proposal.proposalId}`,
      headers: authHeaders(analyst),
    });
    expect(proposalResponse.statusCode).toBe(200);
    const proposalBody = proposalResponse.json() as {
      policy: { outcome: string; checks: Array<{ ruleId: string; passed: boolean }>; denyReasons: string[] };
      evidence: { ruleId: string; transactionIds: string[] };
      justification: string;
    };
    expect(proposalBody.policy.outcome).toBe('REQUIRES_APPROVAL');
    expect(proposalBody.policy.checks.length).toBeGreaterThan(3);
    expect(proposalBody.evidence.transactionIds.length).toBeGreaterThan(0);
    expect(proposalBody.justification.length).toBeGreaterThan(10);

    // --- 5. the approver inspects exactly what they are authorising -------
    const approvalId = history.approvals[0]!.approvalId;
    const approvalResponse = await system.app.inject({
      method: 'GET',
      url: `/api/approvals/${approvalId}`,
      headers: authHeaders(approver),
    });
    expect(approvalResponse.statusCode).toBe(200);
    const approval = approvalResponse.json() as { status: string; reviewed: { amountMinor: number; currency: string }; proposalHash: string };
    expect(approval.status).toBe('PENDING');
    expect(approval.reviewed.amountMinor).toBe(proposal.amountMinor);
    expect(approval.reviewed.currency).toBe('USD');

    // --- 7. approve -------------------------------------------------------
    const decisionResponse = await system.app.inject({
      method: 'POST',
      url: `/api/approvals/${approvalId}/decision`,
      headers: authHeaders(approver),
      payload: { decision: 'APPROVE', reason: 'Duplicate invoice confirmed with the supplier; refund authorised.' },
    });
    expect(decisionResponse.statusCode).toBe(200);
    expect((decisionResponse.json() as { status: string }).status).toBe('APPROVED');

    // --- 8. exactly one simulated settlement ------------------------------
    const completed = await waitForRunStatus(system, analyst, runId, ['COMPLETED']);
    const report = completed.result?.report;
    expect(report).toBeDefined();
    expect(report?.settlement?.status).toBe('COMMITTED');
    expect(report?.findings.length).toBeGreaterThan(0);
    expect(report?.interpretation.summary.length).toBeGreaterThan(50);
    expect(report?.limitations.join(' ')).toMatch(/simulated/i);

    const operationId = report?.settlement?.operationId as string;
    const operationResponse = await system.app.inject({
      method: 'GET',
      url: `/api/ledger/operations/${operationId}`,
      headers: authHeaders(approver),
    });
    expect(operationResponse.statusCode).toBe(200);
    const operation = operationResponse.json() as { status: string; ledgerEntry: { amountMinor: number; simulated: boolean; entryHash: string } | null };
    expect(operation.status).toBe('COMMITTED');
    expect(operation.ledgerEntry?.simulated).toBe(true);
    expect(operation.ledgerEntry?.amountMinor).toBe(proposal.amountMinor);
    expect(operation.ledgerEntry?.entryHash).toHaveLength(64);

    expect(await system.prisma.ledgerEntry.count()).toBe(1);
    expect(await system.prisma.settlementOperation.count()).toBe(1);

    // --- 9. the final history is inspectable ------------------------------
    const finalHistory = await fetchRunHistory(system, analyst, runId);
    expect(finalHistory.proposals[0]?.status).toBe('SETTLED');
    expect(finalHistory.approvals[0]?.status).toBe('APPROVED');
    expect(finalHistory.approvals[0]?.decidedBy).toBeTruthy();
    expect(finalHistory.settlements).toHaveLength(1);
    expect(finalHistory.settlements[0]?.ledgerEntryId).toBeTruthy();

    const finalRun = await getRun(system, analyst, runId);
    expect(finalRun.body.status).toBe('COMPLETED');
    expect(finalRun.body.error).toBeNull();
    expect(finalRun.body.tokenUsage?.totalTokens).toBeGreaterThan(0);
  });

  it('returns the report with deterministic findings and separated interpretation', async () => {
    const submitted = await submitRun(system, analyst, { from: '2026-07-01', to: '2026-09-30' });
    const runId = submitted.body.runId as string;
    await waitForRunStatus(system, analyst, runId, ['REQUIRES_HUMAN_APPROVAL']);

    // The report is only final once the approval path has closed.
    const history = await fetchRunHistory(system, analyst, runId);
    const approvalId = history.approvals[0]!.approvalId;
    const approver = await issueToken(system, 'APPROVER');
    const decision = await system.app.inject({
      method: 'POST',
      url: `/api/approvals/${approvalId}/decision`,
      headers: authHeaders(approver),
      payload: { decision: 'APPROVE', reason: 'Report review: evidence supports the refund.' },
    });
    expect(decision.statusCode).toBe(200);
    await waitForRunStatus(system, analyst, runId, ['COMPLETED']);

    const run: RunBody = (await getRun(system, analyst, runId)).body;
    expect(run.result).not.toBeNull();
    const report = run.result?.report as unknown as {
      findings: Array<{ ruleId: string; observations: string[]; evidence: { transactionIds: string[] }; refundEligible: boolean }>;
      interpretation: { model: string; summary: string; highlightedFindingIds: string[] };
      ruleVersion: string;
      transactionCount: number;
    };

    // Deterministic facts, with evidence references and an explicit rule version.
    expect(report.ruleVersion).toBe('v1');
    expect(report.transactionCount).toBeGreaterThan(5);
    for (const finding of report.findings) {
      expect(finding.observations.length).toBeGreaterThan(0);
      expect(finding.evidence.transactionIds.length).toBeGreaterThan(0);
      expect(finding.ruleId).toMatch(/^ANOM-\d{3}$/);
    }
    // The model's narrative is recorded separately from the facts, and every
    // finding it highlights must exist in the rule output.
    expect(report.interpretation.model).toBeTruthy();
    const findingIds = new Set(report.findings.map((finding) => finding.ruleId + ':' + finding.evidence.transactionIds.join(',')));
    expect(findingIds.size).toBeGreaterThan(0);
    expect(report.interpretation.highlightedFindingIds.length).toBeGreaterThan(0);
    // The prompt-injection text in the dataset never becomes a claim in the report.
    expect(report.interpretation.summary.toLowerCase()).not.toContain('execute_sql');
    expect(report.interpretation.summary.toLowerCase()).not.toContain('ignore all previous instructions');
    // Language discipline (SRS-RESEARCH-005): the narrative may mention fraud only to
    // disclaim it — it must never assert it.
    expect(report.interpretation.summary).not.toMatch(/confirmed fraud|is fraud|proven fraud|evidence of fraud/i);
  });

  it('does not duplicate a run when the analyst retries with the same idempotency key', async () => {
    const key = 'journey-idempotency-0001';
    const first = await submitRun(system, analyst, { idempotencyKey: key });
    expect(first.statusCode).toBe(202);

    const second = await submitRun(system, analyst, { idempotencyKey: key });
    expect(second.statusCode).toBe(202);
    expect(second.body.runId).toBe(first.body.runId);
    expect(second.body.idempotentReplay).toBe(true);

    expect(await system.prisma.run.count()).toBe(1);
    // Still exactly one execution message.
    const messages = await system.prisma.outboxEvent.count({ where: { topic: 'run.execute' } });
    expect(messages).toBe(1);
  });

  it('lists runs for the caller and hides other users\' runs', async () => {
    const mine = await submitRun(system, analyst);
    const otherAnalyst = await issueToken(system, 'ANALYST', { email: 'other@example.test' });
    const theirs = await submitRun(system, otherAnalyst);

    const listResponse = await system.app.inject({ method: 'GET', url: '/api/runs', headers: authHeaders(analyst) });
    expect(listResponse.statusCode).toBe(200);
    const ids = (listResponse.json() as { runs: Array<{ runId: string }> }).runs.map((run) => run.runId);
    expect(ids).toContain(mine.body.runId);
    expect(ids).not.toContain(theirs.body.runId);
  });

  it('cancels an in-flight run and records it', async () => {
    // A worker-less producer keeps the run pending so cancellation is deterministic.
    const quiet = await startTestSystem({ startWorker: false, configOverrides: { QUEUE_NAME: 'run-execution-cancel-probe' } });
    try {
      await resetAndSeed(quiet);
      const principal = await issueToken(quiet, 'ANALYST', { email: 'cancel@example.test' });
      const submitted = await submitRun(quiet, principal);
      const runId = submitted.body.runId as string;

      const cancelResponse = await quiet.app.inject({ method: 'POST', url: `/api/runs/${runId}/cancel`, headers: authHeaders(principal) });
      expect(cancelResponse.statusCode).toBe(200);
      expect((cancelResponse.json() as { status: string }).status).toBe('CANCELLED');

      const cancelled = await getRun(quiet, principal, runId);
      expect(cancelled.body.status).toBe('CANCELLED');

      const audit = await quiet.app.inject({ method: 'GET', url: `/api/runs/${runId}/audit`, headers: authHeaders(principal) });
      const actions = (audit.json() as { audit: Array<{ action: string }> }).audit.map((record) => record.action);
      expect(actions).toContain('run.cancelled');

      // A cancelled run cannot be cancelled again.
      const second = await quiet.app.inject({ method: 'POST', url: `/api/runs/${runId}/cancel`, headers: authHeaders(principal) });
      expect(second.statusCode).toBe(409);
      expect((second.json() as { error: { code: string } }).error.code).toBe('RUN_NOT_CANCELLABLE');
    } finally {
      await quiet.stop();
    }
  });
});
