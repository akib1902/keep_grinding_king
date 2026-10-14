/**
 * Live end-to-end demonstration.
 *
 * This drives the *running* system over HTTP only — no internal imports beyond
 * configuration — so it exercises exactly what a reviewer would exercise with
 * curl. It walks the journey from the PRD:
 *
 *   1. submit a Q3 spend-analysis request as the analyst,
 *   2. watch progress on the SSE stream,
 *   3. inspect the anomaly findings, evidence and refund proposal,
 *   4. approve it as an authorized approver (a second, distinct user),
 *   5. observe exactly one simulated settlement in the ledger,
 *   6. print the audit trail and the execution history.
 *
 * Usage:
 *   npm run demo                 # full journey, including the approval
 *   npm run demo -- --no-approve # stop at the approval pause
 *   npm run demo -- --reject     # reject instead, and show no settlement
 */
import { loadConfig } from '../src/config/env.js';

interface DemoOptions {
  approve: boolean;
  reject: boolean;
}

function parseOptions(argv: string[]): DemoOptions {
  return {
    approve: !argv.includes('--no-approve'),
    reject: argv.includes('--reject'),
  };
}

const POLL_TIMEOUT_MS = 60_000;

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  const config = loadConfig();
  const base = config.api.appOrigin.replace(/\/$/, '');

  const line = (text = ''): void => console.log(text);
  const step = (index: number, text: string): void => line(`\n\x1b[1m${index}. ${text}\x1b[0m`);

  line(`Resilient Multi-Step Financial Research & Settlement Agent — live demo`);
  line(`API: ${base}`);
  line(`Provider: ${config.llm.provider}   Policy: ${config.policy.version}   Approval threshold: ${config.policy.approvalThresholdMinor / 100} ${config.policy.currency}`);
  line('All financial data in this demonstration is synthetic and all settlement is simulated.');

  await assertHealthy(base);

  // --- tokens -----------------------------------------------------------------
  const analyst = await issueToken(base, 'ANALYST');
  const approver = await issueToken(base, 'APPROVER');
  line(`\nAnalyst:  ${analyst.user.email} (${analyst.user.role})`);
  line(`Approver: ${approver.user.email} (${approver.user.role}) — a different person, as separation of duties requires`);

  // --- 1. submit --------------------------------------------------------------
  step(1, 'Submitting the research request (POST /api/runs)');
  const idempotencyKey = `demo-${Date.now()}`;
  const submitted = await post(`${base}/api/runs`, analyst.token, {
    task: 'Analyse Q3 supplier spend, identify anomalies and prepare evidence-backed refund proposals.',
    taskType: 'SPEND_ANOMALY_RESEARCH',
    from: '2026-07-01',
    to: '2026-09-30',
    currency: 'USD',
  }, { 'idempotency-key': idempotencyKey });
  const runId = submitted.body.runId as string;
  line(`   HTTP ${submitted.status} — runId ${runId} (status ${submitted.body.status})`);
  line('   The HTTP response did not wait for execution, as required.');

  // Replaying the identical request must not create a second run.
  const replay = await post(`${base}/api/runs`, analyst.token, {
    task: 'Analyse Q3 supplier spend, identify anomalies and prepare evidence-backed refund proposals.',
    taskType: 'SPEND_ANOMALY_RESEARCH',
    from: '2026-07-01',
    to: '2026-09-30',
    currency: 'USD',
  }, { 'idempotency-key': idempotencyKey });
  line(`   Idempotent replay returned HTTP ${replay.status} with the same runId: ${replay.body.runId === runId ? 'yes' : 'NO'}`);

  // --- 2. stream progress -----------------------------------------------------
  step(2, 'Streaming progress from GET /api/tasks/:id/stream');
  const streamPromise = consumeStream(`${base}/api/tasks/${runId}/stream`, analyst.token);

  const paused = await waitForStatus(base, analyst.token, runId, ['REQUIRES_HUMAN_APPROVAL', 'COMPLETED', 'FAILED']);
  line(`   Run reached status: ${paused.status}`);

  // --- 3. inspect findings and the proposal ----------------------------------
  step(3, 'Inspecting the execution history and the refund proposal');
  const steps = await get(`${base}/api/runs/${runId}/steps`, analyst.token);
  for (const record of (steps.body.steps as Array<{ sequence: number; type: string; status: string; summary: string | null }>).slice(0, 12)) {
    line(`   #${record.sequence} ${record.type.padEnd(19)} ${record.status.padEnd(9)} ${record.summary ?? ''}`);
  }

  const history = await get(`${base}/api/runs/${runId}/history`, analyst.token);
  const proposal = (history.body.proposals as Array<Record<string, unknown>>)[0];
  if (!proposal) {
    line('   No refund proposal was created for this window.');
  } else {
    const detail = await get(`${base}/api/refund-proposals/${proposal.proposalId}`, analyst.token);
    const policy = detail.body.policy as { outcome: string; checks: Array<{ ruleId: string; passed: boolean }> };
    line(`\n   Proposal ${proposal.proposalId}`);
    line(`     amount:   ${(proposal.amountMinor as number) / 100} ${proposal.currency}`);
    line(`     status:   ${proposal.status}`);
    line(`     policy:   ${policy.outcome} (${policy.checks.length} rules evaluated, ${policy.checks.filter((c) => !c.passed).length} not satisfied)`);
    line(`     evidence: ${JSON.stringify((detail.body.evidence as { ruleId?: string }).ruleId ?? '')} ${JSON.stringify((detail.body.evidence as { transactionIds?: string[] }).transactionIds ?? []).slice(0, 80)}`);
    line(`     justification: ${String(detail.body.justification).slice(0, 120)}...`);
  }

  const approval = (history.body.approvals as Array<Record<string, unknown>>)[0];
  if (approval) {
    line(`\n   Approval request ${approval.approvalId} — status ${approval.status}, expires ${approval.expiresAt}`);
  }

  // --- 4. human decision -----------------------------------------------------
  if (approval && options.approve) {
    const decision = options.reject ? 'REJECT' : 'APPROVE';
    step(4, `Recording the human decision (POST /api/approvals/:id/decision → ${decision})`);
    const decided = await post(
      `${base}/api/approvals/${approval.approvalId}/decision`,
      approver.token,
      { decision, reason: options.reject ? 'Supplier confirmed the second charge is legitimate.' : 'Evidence reviewed and refund authorised.' },
    );
    line(`   HTTP ${decided.status} — approval is now ${decided.body.status}`);

    // An unauthorized attempt must fail.
    const forbidden = await post(
      `${base}/api/approvals/${approval.approvalId}/decision`,
      analyst.token,
      { decision: 'APPROVE' },
    );
    line(`   Analyst attempting the same decision: HTTP ${forbidden.status} (${forbidden.body.error?.code}) — refused as expected`);
  } else if (approval) {
    step(4, 'Stopping at the approval pause (--no-approve)');
    line('   The run is durably paused. Approve it later with the API and the workflow resumes.');
  }

  // --- 5. settlement ---------------------------------------------------------
  let final = paused;
  if (approval && options.approve) {
    // The approval resumes the workflow through the durable outbox, so wait for the
    // terminal state rather than the previous pause.
    final = await waitForStatus(base, analyst.token, runId, ['COMPLETED', 'FAILED'], 60_000);
  }
  step(5, `Final run state: ${final.status}`);
  const report = (final.result as { report?: Record<string, unknown> } | null)?.report;
  if (report) {
    const findings = report.findings as Array<{ ruleId: string; title: string; refundEligible: boolean; suggestedRefundMinor: number }>;
    line(`   Window ${JSON.stringify(report.window)} — ${report.transactionCount} transactions, rule version ${report.ruleVersion}`);
    for (const finding of findings) {
      line(`   • ${finding.ruleId} ${finding.title}${finding.refundEligible ? ` — refund eligible up to ${finding.suggestedRefundMinor / 100} USD` : ' — not refund eligible'}`);
    }
    const settlement = report.settlement as { operationId: string; ledgerEntryId: string; amountMinor: number } | undefined;
    if (settlement) {
      line(`\n   Settlement committed exactly once:`);
      line(`     operationId:   ${settlement.operationId}`);
      line(`     ledgerEntryId: ${settlement.ledgerEntryId}`);
      line(`     amount:        ${settlement.amountMinor / 100} USD (simulated)`);
      const operation = await get(`${base}/api/ledger/operations/${settlement.operationId}`, approver.token);
      const entry = operation.body.ledgerEntry as Record<string, unknown> | null;
      line(`     ledger entry:  ${JSON.stringify(entry?.entryType)} ${Number(entry?.amountMinor) / 100} ${entry?.currency} simulated=${String(entry?.simulated)}`);
    } else {
      line('\n   No settlement: no refund was authorised for this run.');
    }
    const interpretation = report.interpretation as { summary: string };
    line(`\n   Interpretation (model narrative, separate from the facts above):`);
    line(`   ${interpretation.summary.split('\n').join('\n   ')}`);
    line(`\n   Limitations recorded with the report:`);
    for (const limitation of report.limitations as string[]) line(`   - ${limitation}`);
  }

  // --- 6. audit --------------------------------------------------------------
  step(6, 'Audit trail (GET /api/runs/:id/audit)');
  const audit = await get(`${base}/api/runs/${runId}/audit`, analyst.token);
  for (const record of audit.body.audit as Array<{ createdAt: string; actorType: string; actorId: string | null; action: string }>) {
    line(`   ${record.createdAt}  ${record.actorType.padEnd(6)}  ${record.action}`);
  }

  const stream = await streamPromise;
  line(`\nSSE: received ${stream.events.length} durable events (last: ${stream.events.at(-1)?.type ?? 'none'}) for run ${runId}.`);
  line('\nDemo complete. All data was synthetic and all settlement was simulated.');
}

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

async function assertHealthy(base: string): Promise<void> {
  const live = await fetch(`${base}/health/live`).catch(() => null);
  if (!live || !live.ok) {
    throw new Error(`The API is not reachable at ${base}. Start it with \`npm run dev:api\` (and the worker with \`npm run dev:worker\`).`);
  }
  const ready = await fetch(`${base}/health/ready`);
  const body = (await ready.json()) as { status: string; checks: Record<string, string> };
  console.log(`\nReadiness before starting: ${JSON.stringify(body.checks)}`);
  if (body.status !== 'ready') {
    throw new Error(`The API is not ready: ${JSON.stringify(body.checks)}. Run \`npm run infra:up\` and \`npm run db:migrate\`.`);
  }
}

interface Token {
  token: string;
  user: { email: string; role: string };
}

async function issueToken(base: string, role: 'ANALYST' | 'APPROVER'): Promise<Token> {
  const email = `${role.toLowerCase()}@example.test`;
  const response = await fetch(`${base}/api/auth/dev-token`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ role, tenantId: 'tenant-demo', email, subject: `local:${role.toLowerCase()}:${email}` }),
  });
  if (!response.ok) {
    throw new Error(
      `Could not mint a development ${role} token (HTTP ${response.status}). Is ENABLE_DEV_TOKENS=true in .env?`,
    );
  }
  return (await response.json()) as Token;
}

async function get(url: string, token: string): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

async function post(
  url: string,
  token: string,
  payload: Record<string, unknown>,
  headers: Record<string, string> = {},
): Promise<{ status: number; body: Record<string, unknown> & { error?: { code: string } } }> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, ...headers },
    body: JSON.stringify(payload),
  });
  return { status: response.status, body: (await response.json()) as Record<string, unknown> & { error?: { code: string } } };
}

async function waitForStatus(
  base: string,
  token: string,
  runId: string,
  statuses: string[],
  timeoutMs = POLL_TIMEOUT_MS,
): Promise<Record<string, unknown>> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const response = await get(`${base}/api/runs/${runId}`, token);
    const body = response.body;
    if (statuses.includes(body.status as string)) return body;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for run ${runId} to reach ${statuses.join('/')}.`);
}

async function consumeStream(url: string, token: string): Promise<{ events: Array<{ type: string }> }> {
  const controller = new AbortController();
  const response = await fetch(url, { headers: { authorization: `Bearer ${token}`, accept: 'text/event-stream' }, signal: controller.signal });
  const events: Array<{ type: string }> = [];
  if (!response.body) return { events };

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let closed = false;

  const pump = async (): Promise<void> => {
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let index = buffer.indexOf('\n\n');
        while (index !== -1) {
          const frame = buffer.slice(0, index);
          buffer = buffer.slice(index + 2);
          index = buffer.indexOf('\n\n');
          const type = /^event: (.+)$/m.exec(frame)?.[1]?.trim();
          if (type === 'stream.closed') closed = true;
          else if (type) events.push({ type });
        }
        if (closed) {
          controller.abort();
          return;
        }
      }
    } catch {
      // Aborted by us, or the server closed the connection.
    }
  };

  const finished = pump();
  // Give the stream a bounded lifetime: the demo never hangs on it.
  setTimeout(() => {
    if (!closed) controller.abort();
  }, 30_000).unref?.();
  await finished.catch(() => undefined);
  return { events };
}

main().catch((error: unknown) => {
  console.error('\ndemo failed:', error instanceof Error ? error.message : error);
  process.exit(1);
});
