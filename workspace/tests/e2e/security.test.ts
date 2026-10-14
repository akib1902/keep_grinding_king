/**
 * Security matrix — BRD §9, SRS §7.3, SRS §9.4.
 *
 * The acceptance target is "0 unauthorized successful approvals in security
 * tests" and "0 refunds above the threshold bypassing approval". These cases test
 * the ways an attacker would actually try: another user's token, a permission the
 * role does not hold, the requester approving their own refund, a foreign origin,
 * a replayed idempotency key and a replayed approval.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { authHeaders, issueToken, resetAndSeed, startTestSystem, submitRun, waitForRunStatus, fetchRunHistory, type TestSystem } from '../helpers/system.js';
import { checkInfra } from '../helpers/infra.js';
import { mintToken, verifyToken } from '../../src/infra/auth/jwt.js';
import { config } from 'node:process';

const infra = await checkInfra();

describe.skipIf(!infra.ok)(infra.ok ? 'end-to-end: security and authorization' : `end-to-end: security (SKIPPED: ${infra.reason})`, () => {
  let system: TestSystem;

  beforeAll(async () => {
    // No SSE tuning needed here; loops off keeps timings irrelevant.
    system = await startTestSystem();
  });

  afterAll(async () => {
    await system.stop();
  });

  beforeEach(async () => {
    await resetAndSeed(system);
  });

  it('rejects a request with no credentials', async () => {
    const response = await system.app.inject({ method: 'GET', url: '/api/runs' });
    expect(response.statusCode).toBe(401);
    expect((response.json() as { error: { code: string } }).error.code).toBe('AUTHENTICATION_REQUIRED');
  });

  it('rejects a malformed or tampered token', async () => {
    for (const header of ['Bearer not-a-jwt', 'Bearer a.b.c', 'Basic abc']) {
      const response = await system.app.inject({ method: 'GET', url: '/api/runs', headers: { authorization: header } });
      expect([401]).toContain(response.statusCode);
    }
    const response = await system.app.inject({ method: 'GET', url: '/api/runs', headers: { authorization: 'Bearer a.b.c' } });
    expect((response.json() as { error: { code: string } }).error.code).toBe('TOKEN_INVALID');
  });

  it('rejects a correctly signed token for a subject that is not provisioned', async () => {
    // Signed with the real secret, so only user provisioning can reject it.
    const token = await mintToken(
      { userId: 'ghost', subject: 'local:analyst:ghost@example.test', tenantId: 'tenant-demo', email: 'ghost@example.test', role: 'ANALYST' },
      system.config.auth,
    );
    const response = await system.app.inject({ method: 'GET', url: '/api/runs', headers: { authorization: `Bearer ${token}` } });
    expect(response.statusCode).toBe(401);
  });

  it('does not let one analyst read another analyst\'s run or its evidence', async () => {
    const owner = await issueToken(system, 'ANALYST', { email: 'owner@example.test' });
    const other = await issueToken(system, 'ANALYST', { email: 'other@example.test' });
    const submitted = await submitRun(system, owner);
    const runId = submitted.body.runId as string;
    await waitForRunStatus(system, owner, runId, ['REQUIRES_HUMAN_APPROVAL']);

    for (const url of [`/api/runs/${runId}`, `/api/runs/${runId}/steps`, `/api/runs/${runId}/events`, `/api/runs/${runId}/audit`, `/api/runs/${runId}/history`]) {
      const response = await system.app.inject({ method: 'GET', url, headers: authHeaders(other) });
      // Concealment, not "forbidden": a resource id cannot be probed.
      expect(response.statusCode).toBe(404);
      expect(response.body).not.toContain(runId === '' ? '\u0000' : 'readable');
    }

    const ownerView = await system.app.inject({ method: 'GET', url: `/api/runs/${runId}`, headers: authHeaders(owner) });
    expect(ownerView.statusCode).toBe(200);
  });

  it('does not let an analyst approve anything', async () => {
    const analyst = await issueToken(system, 'ANALYST', { email: 'approver-attempt@example.test' });
    const owner = await issueToken(system, 'ANALYST', { email: 'owner2@example.test' });
    const submitted = await submitRun(system, owner);
    const runId = submitted.body.runId as string;
    await waitForRunStatus(system, owner, runId, ['REQUIRES_HUMAN_APPROVAL']);
    const history = await fetchRunHistory(system, owner, runId);
    const approvalId = history.approvals[0]!.approvalId;

    const response = await system.app.inject({
      method: 'POST',
      url: `/api/approvals/${approvalId}/decision`,
      headers: authHeaders(analyst),
      payload: { decision: 'APPROVE' },
    });
    expect(response.statusCode).toBe(403);
    expect((response.json() as { error: { code: string } }).error.code).toBe('FORBIDDEN');

    // Nothing changed and no money moved.
    expect(await system.prisma.ledgerEntry.count()).toBe(0);
    expect(await system.prisma.approvalRequest.count({ where: { status: 'PENDING' } })).toBe(1);
  });

  it('does not let the requester approve their own refund (BUS-RULE-03)', async () => {
    // An ADMIN holds both run:create and approvals:decide, so this is the strongest
    // form of the test: the caller *is* allowed to approve, just not this proposal.
    const requesterApprover = await issueToken(system, 'ADMIN', { email: 'requester-approver@example.test' });
    const submitted = await submitRun(system, requesterApprover);
    expect(submitted.statusCode).toBe(202);
    const runId = submitted.body.runId as string;
    await waitForRunStatus(system, requesterApprover, runId, ['REQUIRES_HUMAN_APPROVAL']);
    const history = await fetchRunHistory(system, requesterApprover, runId);
    const approvalId = history.approvals[0]!.approvalId;

    const response = await system.app.inject({
      method: 'POST',
      url: `/api/approvals/${approvalId}/decision`,
      headers: authHeaders(requesterApprover),
      payload: { decision: 'APPROVE', reason: 'I will just approve my own refund' },
    });
    expect(response.statusCode).toBe(403);
    expect((response.json() as { error: { code: string } }).error.code).toBe('SEPARATION_OF_DUTIES');
    expect(await system.prisma.ledgerEntry.count()).toBe(0);
  });

  it('rejects a cross-tenant run, approval and ledger lookup as not found', async () => {
    const tenantA = await issueToken(system, 'ANALYST', { email: 'a@example.test' });
    const tenantB = await issueToken(system, 'ADMIN', { email: 'b@example.test', tenantId: 'tenant-other' });
    const submitted = await submitRun(system, tenantA);
    const runId = submitted.body.runId as string;

    const response = await system.app.inject({ method: 'GET', url: `/api/runs/${runId}`, headers: authHeaders(tenantB) });
    expect(response.statusCode).toBe(404);

    const approval = await system.app.inject({ method: 'GET', url: '/api/approvals/00000000-0000-4000-8000-000000000000', headers: authHeaders(tenantB) });
    expect(approval.statusCode).toBe(404);
    const operation = await system.app.inject({
      method: 'GET',
      url: '/api/ledger/operations/op_does_not_exist',
      headers: authHeaders(tenantB),
    });
    expect(operation.statusCode).toBe(404);
  });

  it('rejects a state-changing request from a foreign origin', async () => {
    const analyst = await issueToken(system, 'ANALYST');
    const response = await system.app.inject({
      method: 'POST',
      url: '/api/runs',
      headers: authHeaders(analyst, { origin: 'https://evil.example.com' }),
      payload: {
        task: 'Cross-origin attempt to submit a run for someone else.',
        from: '2026-07-01',
        to: '2026-09-30',
        currency: 'USD',
      },
    });
    expect(response.statusCode).toBe(403);
    expect(await system.prisma.run.count()).toBe(0);
  });

  it('rejects a reused idempotency key with a different payload (SRS-RUN-007)', async () => {
    const analyst = await issueToken(system, 'ANALYST');
    const key = 'security-idempotency-key-1';
    const first = await submitRun(system, analyst, { idempotencyKey: key });
    expect(first.statusCode).toBe(202);

    const second = await submitRun(system, analyst, { idempotencyKey: key, task: 'A completely different task with the same key.' });
    expect(second.statusCode).toBe(409);
    expect(second.body.error?.code).toBe('IDEMPOTENCY_KEY_REUSED');
    expect(await system.prisma.run.count()).toBe(1);
  });

  it('rejects a repeated approval decision', async () => {
    const owner = await issueToken(system, 'ANALYST', { email: 'repeat-owner@example.test' });
    const approver = await issueToken(system, 'APPROVER', { email: 'repeat-approver@example.test' });
    const submitted = await submitRun(system, owner);
    const runId = submitted.body.runId as string;
    await waitForRunStatus(system, owner, runId, ['REQUIRES_HUMAN_APPROVAL']);
    const approvalId = (await fetchRunHistory(system, owner, runId)).approvals[0]!.approvalId;

    const first = await system.app.inject({
      method: 'POST',
      url: `/api/approvals/${approvalId}/decision`,
      headers: authHeaders(approver),
      payload: { decision: 'APPROVE' },
    });
    expect(first.statusCode).toBe(200);

    const second = await system.app.inject({
      method: 'POST',
      url: `/api/approvals/${approvalId}/decision`,
      headers: authHeaders(approver),
      payload: { decision: 'REJECT' },
    });
    expect(second.statusCode).toBe(409);
    expect((second.json() as { error: { code: string } }).error.code).toBe('APPROVAL_NOT_PENDING');

    await waitForRunStatus(system, owner, runId, ['COMPLETED']);
    expect(await system.prisma.ledgerEntry.count()).toBe(1);
  });

  it('returns a documented error shape for invalid input', async () => {
    const analyst = await issueToken(system, 'ANALYST');
    const cases = [
      { payload: { task: 'too short', from: '2026-09-30', to: '2026-07-01', currency: 'USD' }, expected: 400 },
      { payload: { task: 'A valid task description for the window.', from: 'not-a-date', to: '2026-09-30' }, expected: 400 },
      { payload: { task: 'A valid task description for the window.', from: '2026-07-01', to: '2026-09-30', currency: 'EUR' }, expected: 400 },
      { payload: { task: 'x'.repeat(3000), from: '2026-07-01', to: '2026-09-30' }, expected: 400 },
    ];
    for (const testCase of cases) {
      const response = await system.app.inject({ method: 'POST', url: '/api/runs', headers: authHeaders(analyst), payload: testCase.payload });
      expect(response.statusCode).toBe(testCase.expected);
      const body = response.json() as { error: { code: string; message: string; requestId?: string } };
      expect(body.error.code).toBe('VALIDATION_FAILED');
      expect(body.error.message.length).toBeGreaterThan(0);
      expect(body.error.requestId).toBeTruthy();
    }
    expect(await system.prisma.run.count()).toBe(0);
  });

  it('answers an unknown route with the documented error shape', async () => {
    const response = await system.app.inject({ method: 'GET', url: '/api/nothing-here' });
    expect(response.statusCode).toBe(404);
    expect((response.json() as { error: { code: string } }).error.code).toBe('NOT_FOUND');
  });

  it('never writes a credential into a response body', async () => {
    const analyst = await issueToken(system, 'ANALYST');
    const submitted = await submitRun(system, analyst);
    const runId = submitted.body.runId as string;
    await waitForRunStatus(system, analyst, runId, ['REQUIRES_HUMAN_APPROVAL']);

    for (const url of [`/api/runs/${runId}`, `/api/runs/${runId}/events`, `/api/runs/${runId}/audit`]) {
      const response = await system.app.inject({ method: 'GET', url, headers: authHeaders(analyst) });
      expect(response.body).not.toContain(system.config.auth.jwtSecret);
      expect(response.body.toLowerCase()).not.toContain('bearer ');
      expect(response.body).not.toContain(system.config.database.url);
    }
  });

  it('exposes only distinguishishable liveness and readiness probes', async () => {
    const live = await system.app.inject({ method: 'GET', url: '/health/live' });
    expect(live.statusCode).toBe(200);
    const ready = await system.app.inject({ method: 'GET', url: '/health/ready' });
    expect(ready.statusCode).toBe(200);
    const body = ready.json() as { status: string; checks: Record<string, string> };
    expect(body.status).toBe('ready');
    expect(body.checks.database).toBe('ok');
    expect(body.checks.redis).toBe('ok');
  });

  it('does not register the development token endpoint when disabled', async () => {
    const hardened = await startTestSystem({ configOverrides: { ENABLE_DEV_TOKENS: 'false', QUEUE_NAME: 'run-execution-hardened' } });
    try {
      const response = await hardened.app.inject({ method: 'POST', url: '/api/auth/dev-token', payload: { role: 'ADMIN' } });
      expect(response.statusCode).toBe(404);
    } finally {
      await hardened.stop();
    }
  });

  it('binds a token to its issuer and audience', async () => {
    const analyst = await issueToken(system, 'ANALYST');
    const decoded = await verifyToken(analyst.token, system.config.auth);
    expect(decoded.tenantId).toBe(analyst.tenantId);

    await expect(
      verifyToken(analyst.token, { ...system.config.auth, audience: 'some-other-service' }),
    ).rejects.toMatchObject({ code: 'TOKEN_INVALID' });
    await expect(verifyToken(analyst.token, { ...system.config.auth, issuer: 'https://evil.example.com' })).rejects.toMatchObject({
      code: 'TOKEN_INVALID',
    });
    void config;
  });
});
