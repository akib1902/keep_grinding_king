'use client';

import Link from 'next/link';
import { useMemo } from 'react';
import { CheckCircle2, ClipboardList, Clock, PlayCircle, Plus, XCircle } from 'lucide-react';
import { PageHeader } from '@/components/layout/page-header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { CardSkeleton, TableSkeleton } from '@/components/ui/skeleton';
import { Alert } from '@/components/ui/alert';
import { MetricCard } from '@/components/data-display/metric-card';
import { ApprovalStatusBadge, SettlementStatusBadge } from '@/components/data-display/status-badge';
import { EmptyState, ErrorState } from '@/components/data-display/states';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow, TableWrapper } from '@/components/ui/table';
import { useReadiness } from '@/features/system/hooks';
import { useRuns, useRunHistories } from '@/features/runs/hooks';
import { sortRunsByCreatedDesc, summarizeRuns, runsWithApprovalHistory } from '@/features/runs/aggregate';
import { buildApprovalRows } from '@/features/approvals/rows';
import { buildLedgerRows } from '@/features/ledger/rows';
import { RunsTable } from '@/features/runs/components/runs-table';
import { formatCountdown, formatDateTime, formatMoney, shortId } from '@/lib/formatters';

const TODAY = new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

/**
 * Overview dashboard (FDD §7.1).
 *
 * Two rules shape this page:
 *  - every summary value is a count over API responses, and an unavailable
 *    dataset renders "Unavailable" instead of a misleading zero,
 *  - every card links to the filtered list it summarises.
 */
export default function OverviewPage() {
  const runsQuery = useRuns();
  const readiness = useReadiness();

  const runs = useMemo(() => sortRunsByCreatedDesc(runsQuery.data ?? []), [runsQuery.data]);
  const summary = useMemo(() => (runsQuery.data ? summarizeRuns(runs) : null), [runsQuery.data, runs]);

  const historyCandidates = useMemo(() => runsWithApprovalHistory(runs).slice(0, 25), [runs]);
  const histories = useRunHistories(historyCandidates);
  const approvalRows = useMemo(() => buildApprovalRows(histories.entries), [histories.entries]);
  const pendingApprovals = useMemo(() => approvalRows.filter((row) => row.status === 'PENDING').slice(0, 5), [approvalRows]);
  const ledgerRows = useMemo(() => buildLedgerRows(runs, histories.entries).slice(0, 5), [runs, histories.entries]);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Overview"
        description={`Operational summary for ${TODAY.format(new Date())}. Values below are derived from the authenticated API responses only.`}
        actions={
          <Link
            href="/runs/new"
            className="inline-flex h-9 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary-hover"
          >
            <Plus aria-hidden="true" className="size-4" />
            New research run
          </Link>
        }
      />

      {runsQuery.isError ? (
        <ErrorState
          error={runsQuery.error}
          onRetry={() => void runsQuery.refetch()}
          title="The run list could not be loaded"
          context="Summary cards show “Unavailable” rather than zero, because an unknown value is not the same as zero."
        />
      ) : null}

      <section aria-label="Run summary" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {runsQuery.isPending ? (
          Array.from({ length: 4 }).map((_, index) => <CardSkeleton key={index} />)
        ) : (
          <>
            <MetricCard
              label="Active runs"
              value={summary ? summary.active : null}
              hint="Queued or executing"
              href="/runs?status=PENDING"
              icon={<PlayCircle aria-hidden="true" className="size-4" />}
            />
            <MetricCard
              label="Awaiting approval"
              value={summary ? summary.awaitingApproval : null}
              hint="Paused for a human decision"
              href="/runs?status=REQUIRES_HUMAN_APPROVAL"
              icon={<Clock aria-hidden="true" className="size-4" />}
            />
            <MetricCard
              label="Completed runs"
              value={summary ? summary.completed : null}
              hint="Reached a terminal outcome"
              href="/runs?status=COMPLETED"
              icon={<CheckCircle2 aria-hidden="true" className="size-4" />}
            />
            <MetricCard
              label="Failed runs"
              value={summary ? summary.failed : null}
              hint="Stopped on an error"
              href="/runs?status=FAILED"
              icon={<XCircle aria-hidden="true" className="size-4" />}
            />
          </>
        )}
      </section>

      <div className="grid gap-6 xl:grid-cols-[2fr_1fr]">
        <Card>
          <CardHeader>
            <CardTitle>Recent research runs</CardTitle>
            <Link href="/runs" className="text-sm font-medium text-primary hover:underline">
              View all runs
            </Link>
          </CardHeader>
          {runsQuery.isPending ? (
            <TableSkeleton rows={5} columns={4} />
          ) : (
            <RunsTable runs={runs.slice(0, 5)} showOwner={false} />
          )}
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Service status</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <div className="flex flex-col gap-1">
              <p className="text-sm text-foreground">{readiness.data?.status === 'ready' ? 'Ready' : readiness.isError ? 'Unreachable' : 'Checking…'}</p>
              <p className="text-xs text-muted">Polled from the public readiness probe every 30 seconds.</p>
            </div>
            <dl className="flex flex-col gap-2">
              {Object.entries(readiness.data?.checks ?? {}).map(([component, value]) => (
                <div key={component} className="flex items-center justify-between gap-3 text-xs">
                  <dt className="text-muted capitalize">{component}</dt>
                  <dd className="font-mono text-secondary">{value}</dd>
                </div>
              ))}
            </dl>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Pending approvals</CardTitle>
            <Link href="/approvals" className="text-sm font-medium text-primary hover:underline">
              Open approvals inbox
            </Link>
          </CardHeader>
          {histories.isLoading ? (
            <TableSkeleton rows={3} columns={3} />
          ) : pendingApprovals.length === 0 ? (
            <EmptyState
              title="Nothing is waiting for a decision"
              description="When a proposal exceeds the configured approval threshold, the run pauses and appears here."
            />
          ) : (
            <TableWrapper>
              <Table>
                <TableHead>
                  <TableRow className="hover:bg-transparent">
                    <TableHeaderCell>Approval</TableHeaderCell>
                    <TableHeaderCell>Amount</TableHeaderCell>
                    <TableHeaderCell>Expires</TableHeaderCell>
                    <TableHeaderCell className="text-right">Action</TableHeaderCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {pendingApprovals.map((row) => (
                    <TableRow key={row.approvalId}>
                      <TableCell>
                        <span className="font-mono text-[12px] text-secondary">{shortId(row.approvalId)}</span>
                        <span className="mt-0.5 block text-[11px] text-muted">run {shortId(row.runId)}</span>
                      </TableCell>
                      <TableCell className="tnum font-medium">
                        {row.amountMinor === null ? '—' : formatMoney(row.amountMinor, row.currency ?? 'USD')}
                      </TableCell>
                      <TableCell className="tnum text-muted">{formatCountdown(row.expiresAt)}</TableCell>
                      <TableCell className="text-right">
                        <Link
                          href={`/approvals/${row.approvalId}`}
                          className="text-sm font-medium text-primary hover:underline"
                        >
                          Review
                        </Link>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableWrapper>
          )}
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Recent settlement activity</CardTitle>
            <Link href="/ledger" className="text-sm font-medium text-primary hover:underline">
              Open settlement ledger
            </Link>
          </CardHeader>
          {histories.isLoading ? (
            <TableSkeleton rows={3} columns={3} />
          ) : ledgerRows.length === 0 ? (
            <EmptyState
              title="No settlement operations recorded"
              description="A settlement operation appears only after an authorised proposal is approved and the simulated settlement commits."
            />
          ) : (
            <TableWrapper>
              <Table>
                <TableHead>
                  <TableRow className="hover:bg-transparent">
                    <TableHeaderCell>Operation</TableHeaderCell>
                    <TableHeaderCell>Amount</TableHeaderCell>
                    <TableHeaderCell>Status</TableHeaderCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {ledgerRows.map((row) => (
                    <TableRow key={row.operationId}>
                      <TableCell className="font-mono text-[12px] text-secondary">{shortId(row.operationId)}</TableCell>
                      <TableCell className="tnum">
                        {row.amountMinor === null ? '—' : formatMoney(row.amountMinor, row.currency ?? 'USD')}
                      </TableCell>
                      <TableCell>
                        <SettlementStatusBadge status={row.status} size="sm" />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableWrapper>
          )}
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Approval activity across recent runs</CardTitle>
          <span className="text-xs text-muted">
            {histories.completed}/{histories.total} run histories loaded
          </span>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {approvalRows.length === 0 ? (
            <p className="text-sm text-muted">No approval requests have been raised for the runs visible to you.</p>
          ) : (
            <ul className="flex flex-col divide-y divide-border">
              {approvalRows.slice(0, 5).map((row) => (
                <li key={row.approvalId} className="flex flex-wrap items-center justify-between gap-3 py-2.5">
                  <div className="flex min-w-0 flex-col">
                    <span className="truncate text-sm text-foreground">
                      {row.amountMinor === null ? 'Proposal' : formatMoney(row.amountMinor, row.currency ?? 'USD')} · supplier{' '}
                      <span className="font-mono text-[12px]">{row.supplierId ? shortId(row.supplierId) : '—'}</span>
                    </span>
                    <span className="text-xs text-muted">
                      requested {formatDateTime(row.requestedAt)} · run {shortId(row.runId)}
                    </span>
                  </div>
                  <div className="flex items-center gap-3">
                    <ApprovalStatusBadge status={row.status} size="sm" />
                    <Link href={`/approvals/${row.approvalId}`} className="text-sm font-medium text-primary hover:underline">
                      Open
                    </Link>
                  </div>
                </li>
              ))}
            </ul>
          )}
          {histories.total > 0 && histories.completed < histories.total ? (
            <Alert tone="neutral" role="note">
              Some run histories could not be loaded, so this list may be incomplete. Reload to retry them.
            </Alert>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>What this console does not do</CardTitle>
          <ClipboardList aria-hidden="true" className="size-4 text-muted" />
        </CardHeader>
        <CardContent className="text-sm text-muted">
          <ul className="flex list-disc flex-col gap-1 pl-4">
            <li>The console never marks a proposal authorised or settled on its own — only backend-confirmed states are shown.</li>
            <li>An approval is not a settlement: they are displayed as separate events with separate statuses.</li>
            <li>Policy thresholds and security settings are not editable here; financial rules live in the backend.</li>
            <li>Settlement is simulated. No bank transfer is initiated by this system in any environment.</li>
          </ul>
        </CardContent>
      </Card>

      {runsQuery.isPending ? null : (
        <p className="flex items-center gap-2 text-xs text-muted">
          <Button variant="ghost" size="sm" onClick={() => void runsQuery.refetch()}>
            Refresh data
          </Button>
          Last loaded {runsQuery.dataUpdatedAt ? formatDateTime(new Date(runsQuery.dataUpdatedAt)) : '—'}
        </p>
      )}
    </div>
  );
}
