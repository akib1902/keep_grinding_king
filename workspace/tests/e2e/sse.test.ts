/**
 * Server-Sent Events — PR-10, SRS-EVENT-001..007.
 *
 * The replay cases are the point of this suite. A client that disconnects and
 * reconnects must receive every event exactly once: no gap, no duplicate. Because
 * the stream is a reader over the durable event table, that property holds even
 * while the worker keeps writing events.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  authHeaders,
  collectSse,
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

const infra = await checkInfra();

async function waitFor(condition: () => boolean, timeoutMs = 20_000, label = 'condition'): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

describe.skipIf(!infra.ok)(infra.ok ? 'end-to-end: event streaming' : `end-to-end: event streaming (SKIPPED: ${infra.reason})`, () => {
  let system: TestSystem;
  let analyst: TestPrincipal;
  let approver: TestPrincipal;

  beforeAll(async () => {
    system = await startTestSystem({
      startLoops: true,
      configOverrides: {
        QUEUE_NAME: 'run-execution-sse',
        // Fast tailing and frequent heartbeats keep the suite quick without
        // changing the mechanism under test.
        SSE_POLL_INTERVAL_MS: '50',
        SSE_HEARTBEAT_MS: '150',
      },
    });
  });

  afterAll(async () => {
    await system.stop();
  });

  beforeEach(async () => {
    await resetAndSeed(system);
    analyst = await issueToken(system, 'ANALYST');
    approver = await issueToken(system, 'APPROVER');
  });

  async function runToPause(): Promise<string> {
    const submitted = await submitRun(system, analyst);
    const runId = submitted.body.runId as string;
    await waitForRunStatus(system, analyst, runId, ['REQUIRES_HUMAN_APPROVAL']);
    return runId;
  }

  it('streams progress as it happens and closes cleanly when the run terminates', async () => {
    const runId = await runToPause();
    const stream = await collectSse(system, analyst, runId, { stopWhenClosed: true });

    const history = await fetchRunHistory(system, analyst, runId);
    const decision = await system.app.inject({
      method: 'POST',
      url: `/api/approvals/${history.approvals[0]!.approvalId}/decision`,
      headers: authHeaders(approver),
      payload: { decision: 'APPROVE', reason: 'Streaming test approval.' },
    });
    expect(decision.statusCode).toBe(200);

    await waitForRunStatus(system, analyst, runId, ['COMPLETED']);
    await waitFor(() => stream.closed, 20_000, 'the server to close the stream');

    const types = stream.events.map((event) => event.type);
    expect(types).toEqual(
      expect.arrayContaining(['run.accepted', 'run.started', 'proposal.created', 'approval.required', 'run.awaiting_approval', 'approval.decided', 'run.resumed', 'settlement.committed', 'run.completed']),
    );

    // Every frame carries an id, a type and a versioned payload.
    for (const event of stream.events) {
      expect(event.id).toBeTruthy();
      expect(event.type).toBeTruthy();
      expect(event.payload.runId).toBe(runId);
      expect(typeof event.payload.sequence).toBe('number');
      expect(event.payload.version).toBe(1);
    }

    // Heartbeats arrived, and the stream ended with an explicit close frame.
    expect(stream.heartbeats).toBeGreaterThan(0);
    expect(stream.raw).toContain('event: stream.closed');

    // Nothing sensitive travelled over the wire.
    expect(stream.raw).not.toContain(system.config.auth.jwtSecret);
    expect(stream.raw.toLowerCase()).not.toContain('bearer ');
  }, 60_000);

  it('replays from a known event id with no gap and no duplicate', async () => {
    const runId = await runToPause();
    const first = await collectSse(system, analyst, runId);
    await new Promise((resolve) => setTimeout(resolve, 300));

    // Disconnect at an arbitrary point in the stream.
    const cutIndex = Math.min(3, first.events.length - 1);
    const cut = first.events[cutIndex]!;
    first.abort();

    const history = await fetchRunHistory(system, analyst, runId);
    await system.app.inject({
      method: 'POST',
      url: `/api/approvals/${history.approvals[0]!.approvalId}/decision`,
      headers: authHeaders(approver),
      payload: { decision: 'APPROVE', reason: 'Replay test approval.' },
    });
    await waitForRunStatus(system, analyst, runId, ['COMPLETED']);

    // Reconnect naming the last event actually received.
    const resumed = await collectSse(system, analyst, runId, { lastEventId: cut.id, stopWhenClosed: true });
    await waitFor(() => resumed.closed, 20_000, 'the resumed stream to close');

    expect(resumed.events.length).toBeGreaterThan(0);
    // The replay starts strictly after the acknowledged event...
    expect((resumed.events[0]?.payload.sequence as number) > (cut.payload.sequence as number)).toBe(true);

    // ...and the union of both connections is contiguous with no repeats.
    // An abrupt disconnect means everything after the acknowledged event was never
    // seen by the client, so the comparison starts from the acknowledged event.
    const received = [...first.events.slice(0, cutIndex + 1), ...resumed.events].map((event) => event.payload.sequence as number);
    const unique = [...new Set(received)].sort((a, b) => a - b);
    expect(unique.length).toBe(received.length);
    const missing: number[] = [];
    for (let sequence = 1; sequence <= Math.max(...unique); sequence += 1) {
      if (!unique.includes(sequence)) missing.push(sequence);
    }
    expect(missing).toEqual([]);

    // The replayed tail contains the outcome the first connection never saw.
    const resumedTypes = resumed.events.map((event) => event.type);
    expect(resumedTypes).toContain('run.completed');
    expect(resumedTypes).toContain('settlement.committed');
  }, 60_000);

  it('accepts a numeric sequence as the replay cursor (GET /api/runs/:id/events)', async () => {
    const runId = await runToPause();
    const response = await system.app.inject({
      method: 'GET',
      url: `/api/runs/${runId}/events?afterEventId=2`,
      headers: authHeaders(analyst),
    });
    expect(response.statusCode).toBe(200);
    const events = (response.json() as { events: Array<{ sequence: number }> }).events;
    expect(events.length).toBeGreaterThan(0);
    expect(Math.min(...events.map((event) => event.sequence))).toBe(3);
  });

  it('requires authorization before streaming a run\'s events', async () => {
    const runId = await runToPause();

    const anonymous = await system.app.inject({ method: 'GET', url: `/api/tasks/${runId}/stream` });
    expect(anonymous.statusCode).toBe(401);

    const other = await issueToken(system, 'ANALYST', { email: 'sse-other@example.test' });
    const foreign = await system.app.inject({ method: 'GET', url: `/api/tasks/${runId}/stream`, headers: authHeaders(other) });
    expect(foreign.statusCode).toBe(404);
  });
});
