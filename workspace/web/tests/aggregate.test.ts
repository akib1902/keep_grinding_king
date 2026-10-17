import { describe, expect, it } from 'vitest';
import {
  analysisWindowLabel,
  filterRuns,
  mergeRunEvents,
  runHeadline,
  runDurationMs,
  runRequestSummary,
  runsWithApprovalHistory,
  sortRunsByCreatedDesc,
  stepMetaLabel,
  stepTitle,
  summarizeRuns,
} from '@/features/runs/aggregate';
import { buildApprovalRows } from '@/features/approvals/rows';
import { buildProposalRows, filterProposalRows, isSettled } from '@/features/proposals/rows';
import { buildLedgerRows, filterLedgerRows, isCommittedLedgerEntry } from '@/features/ledger/rows';
import { buildAuditRows, distinctActorTypes, filterAuditRows } from '@/features/audit/rows';
import type { AuditRecord, Run, RunEvent, RunHistory, RunStep } from '@/types/api';

function run(overrides: Partial<Run> = {}): Run {
  return {
    runId: 'run-1',
    tenantId: 'tenant-demo',
    ownerId: 'user-1',
    taskType: 'SPEND_ANOMALY_RESEARCH',
    status: 'PENDING',
    request: {
      task: 'Analyze Q3 spending anomalies and prepare refund proposals with transaction evidence.',
      taskType: 'SPEND_ANOMALY_RESEARCH',
      from: '2026-07-01',
      to: '2026-09-30',
      currency: 'USD',
    },
    policyVersion: 'v1',
    attemptCount: 1,
    attemptId: null,
    tokenUsage: null,
    result: null,
    error: null,
    createdAt: '2026-08-01T10:00:00.000Z',
    startedAt: null,
    completedAt: null,
    ...overrides,
  };
}

describe('summarizeRuns', () => {
  it('counts each status into the bucket the dashboard shows', () => {
    const runs = [
      run({ runId: 'a', status: 'PENDING' }),
      run({ runId: 'b', status: 'RUNNING' }),
      run({ runId: 'c', status: 'REQUIRES_HUMAN_APPROVAL' }),
      run({ runId: 'd', status: 'COMPLETED' }),
      run({ runId: 'e', status: 'COMPLETED' }),
      run({ runId: 'f', status: 'FAILED' }),
      run({ runId: 'g', status: 'CANCELLED' }),
    ];
    expect(summarizeRuns(runs)).toEqual({ total: 7, active: 2, awaitingApproval: 1, completed: 2, failed: 1, cancelled: 1 });
  });

  it('reports zeros for an empty dataset, which is a real value', () => {
    expect(summarizeRuns([])).toEqual({ total: 0, active: 0, awaitingApproval: 0, completed: 0, failed: 0, cancelled: 0 });
  });
});

describe('sortRunsByCreatedDesc', () => {
  it('orders newest first without mutating the input', () => {
    const input = [run({ runId: 'old', createdAt: '2026-07-01T00:00:00.000Z' }), run({ runId: 'new', createdAt: '2026-08-01T00:00:00.000Z' })];
    const sorted = sortRunsByCreatedDesc(input);
    expect(sorted.map((item) => item.runId)).toEqual(['new', 'old']);
    expect(input[0]?.runId).toBe('old');
  });
});

describe('filterRuns', () => {
  const runs = [
    run({ runId: 'aaaa-1111', status: 'COMPLETED', request: { ...run().request, task: 'Analyze Q3 spending anomalies' } }),
    run({ runId: 'bbbb-2222', status: 'FAILED', request: { ...run().request, task: 'Supplier discrepancy review' } }),
  ];

  it('filters by status', () => {
    expect(filterRuns(runs, { status: 'COMPLETED', query: '' })).toHaveLength(1);
    expect(filterRuns(runs, { status: 'ALL', query: '' })).toHaveLength(2);
  });

  it('searches identifiers and request text case-insensitively', () => {
    expect(filterRuns(runs, { status: 'ALL', query: 'BBBB' })).toHaveLength(1);
    expect(filterRuns(runs, { status: 'ALL', query: 'discrepancy' })).toHaveLength(1);
    expect(filterRuns(runs, { status: 'ALL', query: 'nothing here' })).toHaveLength(0);
  });
});

describe('runRequestSummary', () => {
  it('truncates a long request with an ellipsis', () => {
    const long = 'x'.repeat(200);
    const summary = runRequestSummary(run({ request: { ...run().request, task: long } }), 50);
    expect(summary).toHaveLength(50);
    expect(summary.endsWith('…')).toBe(true);
  });

  it('leaves a short request untouched', () => {
    expect(runRequestSummary(run())).toContain('Analyze Q3');
  });
});

describe('runDurationMs', () => {
  it('measures a started run and treats an unfinished one as running', () => {
    expect(runDurationMs(run({ startedAt: '2026-08-01T10:00:00.000Z', completedAt: '2026-08-01T10:00:02.000Z' }))).toBe(2000);
    expect(runDurationMs(run({ startedAt: null }))).toBeNull();
  });
});

describe('runsWithApprovalHistory', () => {
  it('selects the runs whose history can contain a decision', () => {
    const runs = [
      run({ runId: 'a', status: 'REQUIRES_HUMAN_APPROVAL' }),
      run({ runId: 'b', status: 'COMPLETED' }),
      run({ runId: 'c', status: 'FAILED' }),
      run({ runId: 'd', status: 'RUNNING' }),
      run({ runId: 'e', status: 'CANCELLED' }),
    ];
    expect(runsWithApprovalHistory(runs).map((item) => item.runId)).toEqual(['a', 'b', 'c']);
  });
});

function history(overrides: Partial<RunHistory> = {}): RunHistory {
  return {
    runId: 'run-1',
    status: 'COMPLETED',
    proposals: [],
    approvals: [],
    settlements: [],
    ...overrides,
  };
}

describe('mergeRunEvents', () => {
  function durable(overrides: Partial<RunEvent> = {}): RunEvent {
    return { eventId: 'e1', sequence: 1, type: 'run.started', version: 1, payload: {}, createdAt: '2026-08-01T10:00:00.000Z', ...overrides };
  }

  it('de-duplicates an event delivered both durably and live', () => {
    const merged = mergeRunEvents(
      [durable({ eventId: 'e1', sequence: 1 }), durable({ eventId: 'e2', sequence: 2 })],
      [{ id: 'e2', sequence: 2, eventType: 'run.started', payload: {}, createdAt: '2026-08-01T10:00:01.000Z' }],
    );
    expect(merged.map((event) => event.eventId)).toEqual(['e1', 'e2']);
  });

  it('orders by sequence regardless of arrival order', () => {
    const merged = mergeRunEvents(
      [durable({ eventId: 'e3', sequence: 3 })],
      [
        { id: 'e1', sequence: 1, eventType: 'a', payload: {}, createdAt: '' },
        { id: 'e2', sequence: 2, eventType: 'b', payload: {}, createdAt: '' },
      ],
    );
    expect(merged.map((event) => event.sequence)).toEqual([1, 2, 3]);
  });

  it('normalises a live frame into the durable event shape', () => {
    const merged = mergeRunEvents([], [{ id: 'e9', sequence: 9, eventType: 'run.completed', payload: { x: 1 }, createdAt: 'now' }]);
    expect(merged[0]).toMatchObject({ eventId: 'e9', type: 'run.completed', version: 1, payload: { x: 1 } });
  });
});

describe('step labels', () => {
  it('names known step types and passes unknown ones through', () => {
    expect(stepTitle({ type: 'POLICY_EVALUATION' })).toBe('Policy evaluation');
    expect(stepTitle({ type: 'SOMETHING_NEW' as RunStep['type'] })).toBe('SOMETHING_NEW');
  });

  it('summarises tool, policy and timing detail', () => {
    const step = {
      payload: { toolName: 'detect_spend_anomalies' },
      latencyMs: 12,
      errorCode: null,
    } as unknown as RunStep;
    expect(stepMetaLabel(step)).toBe('detect_spend_anomalies · 12 ms');

    const policy = { payload: { outcome: 'DENY', policyVersion: 'v1' }, latencyMs: null, errorCode: null } as unknown as RunStep;
    expect(stepMetaLabel(policy)).toBe('policy DENY · v1');
  });
});

describe('buildApprovalRows', () => {
  const entries = [
    {
      runId: 'run-1',
      history: history({
        proposals: [
          {
            proposalId: 'p1',
            status: 'REQUIRES_APPROVAL',
            amountMinor: 75000,
            currency: 'USD',
            supplierId: 'sup-1',
            transactionId: 'tx-1',
            revision: 1,
            policyOutcome: 'REQUIRES_APPROVAL',
            policyVersion: 'v1',
            requiresApproval: true,
            createdAt: '2026-08-01T10:00:00.000Z',
          },
        ],
        approvals: [
          {
            approvalId: 'ap-1',
            proposalId: 'p1',
            status: 'PENDING',
            expiresAt: '2026-08-01T11:00:00.000Z',
            decidedAt: null,
            decidedBy: null,
            reason: null,
          },
        ],
      }),
    },
  ];

  it('joins each approval to its proposal', () => {
    const rows = buildApprovalRows(entries);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ approvalId: 'ap-1', amountMinor: 75000, currency: 'USD', supplierId: 'sup-1', status: 'PENDING' });
  });

  it('keeps an approval whose proposal could not be joined, without inventing money', () => {
    const orphan = [
      {
        runId: 'run-2',
        history: history({
          approvals: [
            { approvalId: 'ap-2', proposalId: 'missing', status: 'APPROVED', expiresAt: '2026-08-02T11:00:00.000Z', decidedAt: null, decidedBy: null, reason: null },
          ],
        }),
      },
    ];
    const rows = buildApprovalRows(orphan);
    expect(rows[0]?.amountMinor).toBeNull();
    expect(rows[0]?.currency).toBeNull();
  });

  it('orders newest request first', () => {
    const rows = buildApprovalRows([
      ...entries,
      {
        runId: 'run-3',
        history: history({
          proposals: [
            {
              proposalId: 'p3',
              status: 'REQUIRES_APPROVAL',
              amountMinor: 100,
              currency: 'USD',
              supplierId: 'sup-3',
              transactionId: 'tx-3',
              revision: 1,
              policyOutcome: 'REQUIRES_APPROVAL',
              policyVersion: 'v1',
              requiresApproval: true,
              createdAt: '2026-08-05T10:00:00.000Z',
            },
          ],
          approvals: [
            { approvalId: 'ap-3', proposalId: 'p3', status: 'PENDING', expiresAt: '2026-08-05T11:00:00.000Z', decidedAt: null, decidedBy: null, reason: null },
          ],
        }),
      },
    ]);
    expect(rows[0]?.approvalId).toBe('ap-3');
  });
});

describe('proposal rows', () => {
  const entries = [
    {
      runId: 'run-1',
      history: history({
        proposals: [
          {
            proposalId: 'p1',
            status: 'SETTLED',
            amountMinor: 245000,
            currency: 'USD',
            supplierId: 'sup-1',
            transactionId: 'tx-1',
            revision: 1,
            policyOutcome: 'REQUIRES_APPROVAL',
            policyVersion: 'v1',
            requiresApproval: true,
            createdAt: '2026-08-01T10:00:00.000Z',
          },
        ],
        approvals: [
          { approvalId: 'ap-1', proposalId: 'p1', status: 'APPROVED', expiresAt: '2026-08-01T11:00:00.000Z', decidedAt: null, decidedBy: 'u2', reason: null },
        ],
      }),
    },
  ];

  it('marks a proposal settled only from its own status', () => {
    const rows = buildProposalRows(entries);
    expect(isSettled(rows[0]!)).toBe(true);
    expect(rows[0]?.approvalStatus).toBe('APPROVED');
  });

  it('does not treat an approved proposal as settled', () => {
    const approvedOnly = buildProposalRows([
      { runId: 'run-2', history: history({ proposals: [{ ...entries[0]!.history.proposals[0]!, proposalId: 'p2', status: 'APPROVED' }] }) },
    ]);
    expect(isSettled(approvedOnly[0]!)).toBe(false);
  });

  it('filters by status and identifier', () => {
    const rows = buildProposalRows(entries);
    expect(filterProposalRows(rows, 'SETTLED')).toHaveLength(1);
    expect(filterProposalRows(rows, 'REJECTED')).toHaveLength(0);
    expect(filterProposalRows(rows, 'ALL', 'sup-1')).toHaveLength(1);
  });
});

describe('ledger rows', () => {
  const settledRun = run({
    runId: 'run-1',
    status: 'COMPLETED',
    completedAt: '2026-08-01T10:05:00.000Z',
    result: {
      generatedAt: '2026-08-01T10:05:00.000Z',
      report: {
        taskType: 'SPEND_ANOMALY_RESEARCH',
        window: { from: '2026-07-01', to: '2026-09-30' },
        transactionCount: 12,
        totalSpendMinor: 100000,
        currency: 'USD',
        ruleVersion: 'v1',
        findings: [],
        interpretation: { model: 'm', provider: 'p', summary: '', highlightedFindingIds: [] },
        limitations: [],
        proposalIds: ['p1'],
        settlement: { operationId: 'op_1', status: 'COMMITTED', ledgerEntryId: 'le-1', amountMinor: 245000, currency: 'USD' },
      },
    },
  });

  const entries = [
    {
      runId: 'run-1',
      history: history({
        proposals: [
          {
            proposalId: 'p1',
            status: 'SETTLED',
            amountMinor: 245000,
            currency: 'USD',
            supplierId: 'sup-1',
            transactionId: 'tx-1',
            revision: 1,
            policyOutcome: 'REQUIRES_APPROVAL',
            policyVersion: 'v1',
            requiresApproval: true,
            createdAt: '2026-08-01T10:00:00.000Z',
          },
        ],
        settlements: [{ operationId: 'op_1', status: 'COMMITTED', ledgerEntryId: 'le-1', attempts: 1 }],
      }),
    },
  ];

  it('uses the report figure only for the matching operation', () => {
    const rows = buildLedgerRows([settledRun], entries);
    expect(rows[0]).toMatchObject({ operationId: 'op_1', amountMinor: 245000, ledgerEntryId: 'le-1' });
  });

  it('does not attach an unrelated report figure to a different operation', () => {
    const mismatched = [
      {
        runId: 'run-1',
        history: history({ settlements: [{ operationId: 'op_other', status: 'PENDING', ledgerEntryId: null, attempts: 2 }] }),
      },
    ];
    const rows = buildLedgerRows([settledRun], mismatched);
    expect(rows[0]?.amountMinor).toBeNull();
  });

  it('requires a committed status and a ledger entry id to be presentable as settled', () => {
    expect(isCommittedLedgerEntry(buildLedgerRows([settledRun], entries)[0]!)).toBe(true);
    const committedWithoutEntry = [
      { runId: 'run-1', history: history({ settlements: [{ operationId: 'op_2', status: 'COMMITTED', ledgerEntryId: null, attempts: 1 }] }) },
    ];
    expect(isCommittedLedgerEntry(buildLedgerRows([settledRun], committedWithoutEntry)[0]!)).toBe(false);
  });

  it('filters by status, date range and identifier', () => {
    const rows = buildLedgerRows([settledRun], entries);
    expect(filterLedgerRows(rows, { status: 'COMMITTED', query: '' })).toHaveLength(1);
    expect(filterLedgerRows(rows, { status: 'FAILED', query: '' })).toHaveLength(0);
    expect(filterLedgerRows(rows, { status: 'ALL', query: '', from: '2026-08-02' })).toHaveLength(0);
    expect(filterLedgerRows(rows, { status: 'ALL', query: 'op_1' })).toHaveLength(1);
  });
});

describe('audit rows', () => {
  function record(overrides: Partial<AuditRecord> = {}): AuditRecord {
    return {
      auditId: 'aud-1',
      actorType: 'USER',
      actorId: 'user-1',
      action: 'run.submitted',
      targetType: 'run',
      targetId: 'run-1',
      metadata: null,
      createdAt: '2026-08-01T10:00:00.000Z',
      ...overrides,
    };
  }

  const entries = [
    {
      runId: 'run-1',
      audit: [
        record({ auditId: 'a1', action: 'run.submitted', createdAt: '2026-08-01T10:00:00.000Z' }),
        record({ auditId: 'a2', action: 'settlement.committed', actorType: 'AGENT', createdAt: '2026-08-01T10:05:00.000Z', metadata: { operationId: 'op_1' } }),
      ],
    },
  ];

  it('merges runs and orders newest first, tagging the run', () => {
    const rows = buildAuditRows(entries);
    expect(rows.map((row) => row.auditId)).toEqual(['a2', 'a1']);
    expect(rows[0]?.runId).toBe('run-1');
  });

  it('filters by event category group', () => {
    const rows = buildAuditRows(entries);
    expect(filterAuditRows(rows, { action: 'Settlement completed' })).toHaveLength(1);
    expect(filterAuditRows(rows, { action: 'Run created' })).toHaveLength(1);
    expect(filterAuditRows(rows, { action: 'Approval approved or rejected' })).toHaveLength(0);
  });

  it('filters by actor, run and date range', () => {
    const rows = buildAuditRows(entries);
    expect(filterAuditRows(rows, { actorType: 'AGENT' })).toHaveLength(1);
    expect(filterAuditRows(rows, { runId: 'run-1' })).toHaveLength(2);
    expect(filterAuditRows(rows, { runId: 'run-9' })).toHaveLength(0);
    expect(filterAuditRows(rows, { from: '2026-08-02' })).toHaveLength(0);
  });

  it('matches an operation id held in the record metadata', () => {
    const rows = buildAuditRows(entries);
    expect(filterAuditRows(rows, { operationId: 'op_1' })).toHaveLength(1);
    expect(filterAuditRows(rows, { operationId: 'op_9' })).toHaveLength(0);
  });

  it('lists the actor types actually present', () => {
    expect(distinctActorTypes(buildAuditRows(entries))).toEqual(['AGENT', 'USER']);
  });
});

describe('run headline', () => {
  it('names a window that covers exactly one calendar quarter', () => {
    expect(analysisWindowLabel('2026-07-01', '2026-09-30')).toBe('Q3 2026');
    expect(analysisWindowLabel('2026-01-01', '2026-03-31')).toBe('Q1 2026');
    expect(analysisWindowLabel('2026-10-01', '2026-12-31')).toBe('Q4 2026');
  });

  it('falls back to the literal range when the window is not a quarter', () => {
    expect(analysisWindowLabel('2026-07-05', '2026-09-30')).toBe('2026-07-05 → 2026-09-30');
    expect(analysisWindowLabel('2026-07-01', '2026-09-29')).toBe('2026-07-01 → 2026-09-29');
    expect(analysisWindowLabel('2026-07-01', '2026-10-31')).toBe('2026-07-01 → 2026-10-31');
  });

  it('refuses to label a date that does not exist', () => {
    expect(analysisWindowLabel('2026-02-31', '2026-03-31')).toBeNull();
    expect(analysisWindowLabel(undefined, '2026-03-31')).toBeNull();
  });

  it('builds the headline from recorded request fields only', () => {
    expect(runHeadline(run())).toBe('Q3 2026 spending analysis');
    expect(runHeadline(run({ taskType: 'SUPPLIER_DISCREPANCY_REVIEW' }))).toBe(
      'Q3 2026 supplier discrepancy review',
    );
    const unbounded = run({ request: { ...run().request, from: '2026-08-01', to: '2026-08-31' } });
    expect(runHeadline(unbounded)).toBe('2026-08-01 → 2026-08-31 spending analysis');
  });
});
