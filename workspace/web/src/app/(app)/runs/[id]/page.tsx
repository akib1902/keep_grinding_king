'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { Ban, RefreshCw, ShieldCheck, TriangleAlert } from 'lucide-react';
import { PageHeader } from '@/components/layout/page-header';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow, TableWrapper } from '@/components/ui/table';
import { CardSkeleton, TableSkeleton } from '@/components/ui/skeleton';
import { useToast } from '@/components/feedback/toast';
import { CopyableId, DefinitionList } from '@/components/data-display/definition-list';
import { FindingsList } from '@/components/data-display/evidence-card';
import { MetricCard } from '@/components/data-display/metric-card';
import { ApprovalStatusBadge, ProposalStatusBadge, RunStatusBadge } from '@/components/data-display/status-badge';
import { EmptyState, ErrorState } from '@/components/data-display/states';
import { ExecutionTimeline, PayloadBlock, type TimelineEntry } from '@/components/data-display/timeline';
import { useSession } from '@/features/auth/session-provider';
import { useCancelRun, useRun, useRunAudit, useRunEvents, useRunHistory, useRunSteps } from '@/features/runs/hooks';
import { useRunEventStream } from '@/features/runs/stream';
import { RunProgress } from '@/features/runs/components/run-progress';
import { LiveStatusBar } from '@/features/runs/components/live-status';
import { eventOutcomeStatus, mergeRunEvents } from '@/features/runs/aggregate';
import { isLiveRun } from '@/features/runs/api';
import { ApiError, describeApiError } from '@/lib/errors';
import {
  formatDateTime,
  formatDurationBetween,
  formatMoney,
  formatNumber,
  formatRunId,
  formatRunReference,
  shortId,
} from '@/lib/formatters';
import { auditActionLabel, eventTypeLabel, policyRuleLabel, runStatusMeta } from '@/lib/status';

export default function RunDetailPage() {
  const params = useParams<{ id: string }>();
  const runId = params?.id ?? null;
  const { session, role } = useSession();
  const toast = useToast();

  const runQuery = useRun(runId);
  const stepsQuery = useRunSteps(runId);
  const eventsQuery = useRunEvents(runId);
  const historyQuery = useRunHistory(runId);
  const auditQuery = useRunAudit(runId);
  const cancel = useCancelRun(runId ?? '');
  const [confirmCancel, setConfirmCancel] = useState(false);

  const run = runQuery.data ?? null;
  const live = isLiveRun(run);

  const stream = useRunEventStream({
    runId,
    token: session?.token ?? null,
    enabled: Boolean(runId) && live,
  });

  const events = useMemo(
    () => mergeRunEvents(eventsQuery.data ?? [], stream.liveEvents),
    [eventsQuery.data, stream.liveEvents],
  );

  const report = run?.result?.report ?? null;
  const proposals = historyQuery.data?.proposals ?? [];
  const pendingApproval = useMemo(() => {
    const approvals = historyQuery.data?.approvals ?? [];
    const pending = approvals.find((approval) => approval.status === 'PENDING');
    if (!pending) return null;
    return { approval: pending, proposal: proposals.find((proposal) => proposal.proposalId === pending.proposalId) ?? null };
  }, [historyQuery.data, proposals]);

  const canCancel = live && (role === 'ANALYST' || role === 'ADMIN');

  if (runQuery.isError) {
    const notFound = runQuery.error instanceof ApiError && runQuery.error.status === 404;
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Research run" breadcrumbs={[{ label: 'Research Runs', href: '/runs' }, { label: 'Not available' }]} />
        <ErrorState
          error={runQuery.error}
          onRetry={notFound ? undefined : () => void runQuery.refetch()}
          title={notFound ? 'Run not found' : 'The run could not be loaded'}
          context={
            notFound
              ? 'The identifier does not exist in your tenant, or it belongs to another analyst. Analysts can only read their own runs.'
              : undefined
          }
        />
        <Link href="/runs" className="text-sm font-medium text-primary hover:underline">
          ← Back to all runs
        </Link>
      </div>
    );
  }

  if (runQuery.isPending || !run) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Loading run…" />
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <CardSkeleton key={index} />
          ))}
        </div>
        <Card>
          <TableSkeleton rows={6} columns={4} />
        </Card>
      </div>
    );
  }

  const taskSummary = run.request.task.length > 120 ? `${run.request.task.slice(0, 119)}…` : run.request.task;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        breadcrumbs={[{ label: 'Research Runs', href: '/runs' }, { label: formatRunReference(run.runId) }]}
        title={taskSummary}
        meta={
          <>
            <RunStatusBadge status={run.status} />
            <span className="text-sm text-muted">
              Run ID: <span className="font-mono text-secondary">{formatRunReference(run.runId)}</span>
            </span>
            <CopyableId value={run.runId} label="full run id" />
          </>
        }
        description={
          <span>
            Analysis window {run.request.from} → {run.request.to} · {run.request.currency} · task type{' '}
            <code className="font-mono">{run.taskType}</code> · policy {run.policyVersion}
          </span>
        }
        actions={
          <>
            <Button variant="secondary" onClick={() => void runQuery.refetch()} disabled={runQuery.isFetching}>
              <RefreshCw aria-hidden="true" className={runQuery.isFetching ? 'animate-spin' : undefined} />
              {runQuery.isFetching ? 'Refreshing…' : 'Refresh'}
            </Button>
            {canCancel ? (
              <Button variant="danger" onClick={() => setConfirmCancel(true)} disabled={cancel.isPending}>
                <Ban aria-hidden="true" />
                Cancel run
              </Button>
            ) : null}
          </>
        }
      />

      {run.status === 'FAILED' && run.error ? (
        <Alert tone="danger" role="alert" title={`Run failed — ${run.error.code}`}>
          <p className="flex items-start gap-2">
            <TriangleAlert aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
            <span>
              {run.error.message} The failure is recorded against this run and no settlement can result from it. Attempts used:{' '}
              {run.attemptCount}.
            </span>
          </p>
        </Alert>
      ) : null}

      {run.status === 'CANCELLED' ? (
        <Alert tone="neutral" role="status" title="Run cancelled">
          The run was cancelled before it reached an outcome. No refund proposal from this run can be approved or settled.
        </Alert>
      ) : null}

      <LiveStatusBar state={stream.state} liveEventCount={stream.liveEvents.length} />

      <section aria-label="Run summary" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="Transactions analysed"
          // `null` while the report does not exist yet; the report is the only
          // authority on this number, so it is never estimated.
          value={report ? formatNumber(report.transactionCount) : null}
          unavailableLabel="Not yet reported"
          hint={report ? `Rule version ${report.ruleVersion}` : 'Available when the research report is finalised'}
        />
        <MetricCard
          label="Findings"
          value={report ? formatNumber(report.findings.length) : null}
          unavailableLabel="Not yet reported"
          hint={
            report
              ? `${report.findings.filter((finding) => finding.refundEligible).length} refund eligible`
              : 'Deterministic rules have not reported yet'
          }
        />
        <MetricCard
          label="Refund proposals"
          value={historyQuery.isPending ? null : formatNumber(proposals.length)}
          unavailableLabel="Unavailable"
          hint={proposals.length > 0 ? `${proposals.filter((proposal) => proposal.status === 'SETTLED').length} settled` : 'None created for this window'}
        />
        <MetricCard
          label="Execution"
          value={runStatusMeta(run.status).label}
          hint={runStatusMeta(run.status).description}
        />
      </section>

      {pendingApproval ? (
        <Card className="border-warning-border">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ShieldCheck aria-hidden="true" className="size-4 text-warning" />
              Pending decision
            </CardTitle>
            <ApprovalStatusBadge status={pendingApproval.approval.status} />
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="flex flex-col gap-1">
              <p className="text-xs text-muted">Supplier refund proposal · policy {pendingApproval.proposal?.policyVersion ?? '—'}</p>
              <p className="tnum text-3xl font-semibold text-foreground">
                {pendingApproval.proposal ? formatMoney(pendingApproval.proposal.amountMinor, pendingApproval.proposal.currency) : 'Amount unavailable'}
              </p>
              <p className="text-sm text-muted">
                The configured policy requires approval for this amount (
                {pendingApproval.proposal?.policyOutcome === 'REQUIRES_APPROVAL'
                  ? 'outcome REQUIRES_APPROVAL'
                  : pendingApproval.proposal?.policyOutcome ?? 'policy outcome unavailable'}
                ). Settlement has not occurred and will not, until a decision is recorded and settlement commits separately.
              </p>
            </div>

            <div className="rounded-md border border-border bg-surface-muted px-4 py-3">
              <p className="text-sm font-medium text-foreground">Next step</p>
              <p className="text-sm text-muted">
                Review the supporting transaction evidence and open the approval request to record a decision.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <Link
                href={`/approvals/${pendingApproval.approval.approvalId}`}
                className="inline-flex h-9 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary-hover"
              >
                Open approval request
              </Link>
              {pendingApproval.proposal ? (
                <Link
                  href={`/refund-proposals/${pendingApproval.proposal.proposalId}`}
                  className="inline-flex h-9 items-center rounded-md border border-border-strong bg-surface px-4 text-sm font-medium text-foreground hover:bg-surface-muted"
                >
                  Inspect the proposal
                </Link>
              ) : null}
              <span className="text-xs text-muted">Decision expires {formatDateTime(pendingApproval.approval.expiresAt)}.</span>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {run.status === 'REQUIRES_HUMAN_APPROVAL' && !pendingApproval && !historyQuery.isPending ? (
        <Alert tone="warning" role="status" title="This run reports that it is paused, but no pending approval was found">
          <p>
            The run status and the approval records disagree. Do not treat this run as decided or settled — reload, and if the mismatch persists,
            treat it as an operational incident. Run status is shown as reported by the API, not corrected by the console.
          </p>
        </Alert>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[3fr_2fr]">
        <Card>
          <CardHeader>
            <CardTitle>Workflow progress</CardTitle>
            <span className="text-xs text-muted">
              {stepsQuery.data ? `${stepsQuery.data.length} recorded steps` : 'loading steps…'} · attempts {run.attemptCount}
            </span>
          </CardHeader>
          <CardContent>
            {stepsQuery.isError ? (
              <ErrorState error={stepsQuery.error} onRetry={() => void stepsQuery.refetch()} title="Execution steps could not be loaded" />
            ) : stepsQuery.isPending ? (
              <TableSkeleton rows={6} columns={2} />
            ) : (
              <RunProgress steps={stepsQuery.data ?? []} />
            )}
          </CardContent>
        </Card>

        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Run summary</CardTitle>
            </CardHeader>
            <CardContent>
              <DefinitionList
                columns={1}
                items={[
                  { term: 'Status', value: <RunStatusBadge status={run.status} size="sm" /> },
                  { term: 'Created', value: formatDateTime(run.createdAt), mono: true },
                  { term: 'Started', value: formatDateTime(run.startedAt), mono: true },
                  { term: 'Completed', value: formatDateTime(run.completedAt), mono: true },
                  { term: 'Elapsed', value: formatDurationBetween(run.startedAt, run.completedAt), mono: true },
                  { term: 'Attempts', value: `${run.attemptCount}`, mono: true },
                  { term: 'Owner', value: shortId(run.ownerId), mono: true },
                  { term: 'Policy version', value: run.policyVersion, mono: true },
                  { term: 'Request', value: run.request.task },
                  ...(run.request.notes ? [{ term: 'Notes', value: run.request.notes }] : []),
                ]}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Execution cost</CardTitle>
            </CardHeader>
            <CardContent>
              {run.tokenUsage ? (
                <DefinitionList
                  columns={2}
                  items={[
                    { term: 'Model turns', value: formatNumber(run.tokenUsage.modelTurns), mono: true },
                    { term: 'Total tokens', value: formatNumber(run.tokenUsage.totalTokens), mono: true },
                    { term: 'Prompt tokens', value: formatNumber(run.tokenUsage.promptTokens), mono: true },
                    { term: 'Completion tokens', value: formatNumber(run.tokenUsage.completionTokens), mono: true },
                    {
                      term: 'Tool calls',
                      value: formatNumber((stepsQuery.data ?? []).filter((step) => step.type === 'TOOL_CALL').length),
                      mono: true,
                    },
                  ]}
                />
              ) : (
                <p className="text-sm text-muted">
                  Token usage is recorded when an attempt completes. Nothing is estimated here.
                </p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Research findings</CardTitle>
          <span className="text-xs text-muted">
            {report ? `Deterministic rules ${report.ruleVersion} · ${report.findings.length} finding(s)` : 'Awaiting the research report'}
          </span>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          {report ? (
            <>
              <FindingsList findings={report.findings} highlighted={report.interpretation.highlightedFindingIds} />
              <div className="rounded-md border border-border bg-surface-muted px-4 py-3">
                <p className="text-xs font-semibold tracking-wide text-muted uppercase">
                  Model interpretation · {report.interpretation.model} ({report.interpretation.provider})
                </p>
                <p className="mt-1 text-sm whitespace-pre-line text-secondary">{report.interpretation.summary}</p>
                <p className="mt-2 text-xs text-muted">
                  This narrative is generated text and is presented separately from the measured evidence above. It is not a determination of
                  fraud and it is not policy.
                </p>
              </div>
              {report.limitations.length > 0 ? (
                <div>
                  <p className="text-xs font-semibold tracking-wide text-muted uppercase">Limitations recorded with the report</p>
                  <ul className="mt-1 flex list-disc flex-col gap-1 pl-4 text-sm text-muted">
                    {report.limitations.map((limitation) => (
                      <li key={limitation}>{limitation}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </>
          ) : (
            <EmptyState
              title="No research report yet"
              description={
                run.status === 'PENDING'
                  ? 'The run is queued. The report appears once the worker completes the analysis.'
                  : 'The report is written when the attempt finishes. Nothing is synthesised by the console in the meantime.'
              }
            />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Refund proposals</CardTitle>
          <span className="text-xs text-muted">
            Settlement is a separate step from approval; a proposal shown as approved is not a settled payment.
          </span>
        </CardHeader>
        {historyQuery.isPending ? (
          <TableSkeleton rows={3} columns={5} />
        ) : proposals.length === 0 ? (
          <EmptyState
            title="No refund proposal was created"
            description="Either the policy engine refused every candidate, or the analysis found nothing eligible for a refund in this window. A refusal is recorded on the audit trail."
          />
        ) : (
          <TableWrapper>
            <Table>
              <TableHead>
                <TableRow className="hover:bg-transparent">
                  <TableHeaderCell>Proposal</TableHeaderCell>
                  <TableHeaderCell>Supplier</TableHeaderCell>
                  <TableHeaderCell>Amount</TableHeaderCell>
                  <TableHeaderCell>Policy</TableHeaderCell>
                  <TableHeaderCell>Status</TableHeaderCell>
                  <TableHeaderCell>Approval</TableHeaderCell>
                  <TableHeaderCell className="text-right">Action</TableHeaderCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {proposals.map((proposal) => {
                  const approval = historyQuery.data?.approvals.find((item) => item.proposalId === proposal.proposalId) ?? null;
                  return (
                    <TableRow key={proposal.proposalId}>
                      <TableCell className="font-mono text-[12px]">
                        <CopyableId value={proposal.proposalId} label="proposal id" />
                      </TableCell>
                      <TableCell className="font-mono text-[12px] text-muted">{shortId(proposal.supplierId)}</TableCell>
                      <TableCell className="tnum font-medium">{formatMoney(proposal.amountMinor, proposal.currency)}</TableCell>
                      <TableCell className="text-xs text-muted">
                        {proposal.policyVersion} · {proposal.policyOutcome}
                      </TableCell>
                      <TableCell>
                        <ProposalStatusBadge status={proposal.status} size="sm" />
                      </TableCell>
                      <TableCell>
                        {approval ? <ApprovalStatusBadge status={approval.status} size="sm" /> : <span className="text-xs text-muted">—</span>}
                      </TableCell>
                      <TableCell className="text-right">
                        <Link
                          href={`/refund-proposals/${proposal.proposalId}`}
                          className="text-sm font-medium text-primary hover:underline"
                        >
                          Open
                        </Link>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </TableWrapper>
        )}
      </Card>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Event history</CardTitle>
            <span className="text-xs text-muted">
              {events.length} durable event(s), de-duplicated by event id
            </span>
          </CardHeader>
          <CardContent>
            {eventsQuery.isError ? (
              <ErrorState error={eventsQuery.error} onRetry={() => void eventsQuery.refetch()} title="Events could not be loaded" />
            ) : events.length === 0 ? (
              <p className="text-sm text-muted">No durable events have been recorded for this run yet.</p>
            ) : (
              <ExecutionTimeline
                entries={events.map<TimelineEntry>((event) => ({
                  id: event.eventId,
                  title: eventTypeLabel(event.type),
                  status: eventOutcomeStatus(event.type),
                  meta: `#${event.sequence} · v${event.version}`,
                  timestamp: event.createdAt,
                  tone: 'muted',
                  detail: <PayloadBlock value={event.payload} />,
                }))}
              />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Audit trail</CardTitle>
            <span className="text-xs text-muted">Recorded by the backend; this view reads it and does not create it.</span>
          </CardHeader>
          <CardContent>
            {auditQuery.isError ? (
              <ErrorState error={auditQuery.error} onRetry={() => void auditQuery.refetch()} title="Audit records could not be loaded" />
            ) : auditQuery.isPending ? (
              <TableSkeleton rows={5} columns={2} />
            ) : (auditQuery.data ?? []).length === 0 ? (
              <p className="text-sm text-muted">No audit records for this run.</p>
            ) : (
              <ol className="flex flex-col divide-y divide-border">
                {(auditQuery.data ?? []).map((record) => (
                  <li key={record.auditId} className="flex flex-col gap-1 py-2.5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-sm font-medium text-foreground">{auditActionLabel(record.action)}</span>
                      <span className="tnum text-xs text-muted">{formatDateTime(record.createdAt)}</span>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
                      <span className="rounded border border-border bg-surface-muted px-1.5 py-0.5 font-mono">{record.action}</span>
                      <span>{record.actorType}</span>
                      {record.actorId ? <span className="font-mono">{shortId(record.actorId, 16)}</span> : null}
                      {record.targetType ? (
                        <span>
                          → {record.targetType} {record.targetId ? shortId(record.targetId) : ''}
                        </span>
                      ) : null}
                    </div>
                    {record.metadata && 'denyReasons' in record.metadata ? (
                      <p className="text-xs text-secondary">
                        Deny reasons:{' '}
                        {(record.metadata.denyReasons as string[]).map((reason) => policyRuleLabel(reason)).join(', ')}
                      </p>
                    ) : null}
                  </li>
                ))}
              </ol>
            )}
          </CardContent>
        </Card>
      </div>

      <Dialog
        open={confirmCancel}
        onClose={() => setConfirmCancel(false)}
        title="Cancel this research run?"
        description="Cancellation stops the workflow. It does not settle anything, and a cancelled run cannot be resumed."
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirmCancel(false)} disabled={cancel.isPending}>
              Keep the run
            </Button>
            <Button
              variant="danger"
              disabled={cancel.isPending}
              onClick={() => {
                cancel.mutate(undefined, {
                  onSuccess: () => {
                    setConfirmCancel(false);
                    toast.toast({ tone: 'neutral', title: 'Cancellation requested', description: 'The run will stop and report a cancelled outcome.' });
                  },
                  onError: (error) => {
                    toast.toast({ tone: 'danger', title: 'Cancellation failed', description: describeApiError(error) });
                  },
                });
              }}
            >
              {cancel.isPending ? 'Cancelling…' : 'Cancel run'}
            </Button>
          </>
        }
      >
        <dl className="flex flex-col gap-2 text-sm">
          <div className="flex justify-between gap-4">
            <dt className="text-muted">Run</dt>
            <dd className="font-mono">{formatRunId(run.runId)}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-muted">Current status</dt>
            <dd>{runStatusMeta(run.status).label}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-muted">Proposals created</dt>
            <dd className="tnum">{proposals.length}</dd>
          </div>
        </dl>
      </Dialog>
    </div>
  );
}
