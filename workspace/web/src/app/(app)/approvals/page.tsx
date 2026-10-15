'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Search } from 'lucide-react';
import { PageHeader } from '@/components/layout/page-header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/field';
import { Tabs } from '@/components/ui/tabs';
import { TableSkeleton } from '@/components/ui/skeleton';
import { Alert } from '@/components/ui/alert';
import { ApprovalStatusBadge } from '@/components/data-display/status-badge';
import { EmptyState, ErrorState } from '@/components/data-display/states';
import { Pagination, pageCountFor, pageSlice } from '@/components/data-display/pagination';
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow, TableWrapper } from '@/components/ui/table';
import { useSession } from '@/features/auth/session-provider';
import { useRuns, useRunHistories } from '@/features/runs/hooks';
import { runsWithApprovalHistory } from '@/features/runs/aggregate';
import { APPROVAL_TABS, buildApprovalRows, filterApprovalRows, tabCounts, type ApprovalTab } from '@/features/approvals/rows';
import { useApprovalDetails } from '@/features/approvals/hooks';
import { formatCountdown, formatDateTime, formatMoney, shortId } from '@/lib/formatters';

const PAGE_SIZE = 15;

/**
 * Approvals inbox (FDD §7.5).
 *
 * Rows are built from run histories and the visible page is enriched with the
 * authoritative approval record, so a decision status is never inferred from a
 * run's status. Expired and decided requests are shown as records, not actions.
 */
export default function ApprovalsPage() {
  const router = useRouter();
  const { role } = useSession();
  const [tab, setTab] = useState<ApprovalTab>('PENDING');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [lookup, setLookup] = useState('');

  const runsQuery = useRuns();
  const candidates = useMemo(() => runsWithApprovalHistory(runsQuery.data ?? []).slice(0, 50), [runsQuery.data]);
  const histories = useRunHistories(candidates);

  const rows = useMemo(() => buildApprovalRows(histories.entries), [histories.entries]);
  const counts = useMemo(() => tabCounts(rows), [rows]);
  const filtered = useMemo(() => filterApprovalRows(rows, tab, query), [rows, tab, query]);

  const pageCount = pageCountFor(filtered.length, PAGE_SIZE);
  const currentPage = Math.min(page, pageCount);
  const visible = pageSlice(filtered, currentPage, PAGE_SIZE);
  const enrichment = useApprovalDetails(visible);
  // An approver does not own the runs, so the run list they may read is empty and
  // an inbox built from run history cannot list anything for them. Opening a
  // record by the identifier they were given still works, because the approval
  // endpoint is authorised on the approval itself.
  const ownerScoped = role === 'APPROVER';

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Approvals"
        description="Refund proposals that required a human decision. Approving a proposal authorises it; settlement is committed separately by the backend."
      />

      {runsQuery.isError ? (
        <ErrorState error={runsQuery.error} onRetry={() => void runsQuery.refetch()} title="The run list could not be loaded" />
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Filters</CardTitle>
          <span className="text-xs text-muted">
            {histories.completed}/{histories.total} run histories loaded
            {enrichment.isLoading ? ' · enriching visible rows…' : ''}
          </span>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          <Field label="Search" htmlFor="approvals-search" hint="Matches approval, run, proposal or supplier identifiers.">
            <div className="relative max-w-md">
              <Search aria-hidden="true" className="pointer-events-none absolute top-2.5 left-3 size-4 text-muted" />
              <Input
                id="approvals-search"
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setPage(1);
                }}
                placeholder="Search approvals…"
                className="pl-9"
              />
            </div>
          </Field>

          <form
            className="flex flex-wrap items-end gap-3 border-t border-border pt-5"
            onSubmit={(event) => {
              event.preventDefault();
              const id = lookup.trim();
              if (id) router.push(`/approvals/${encodeURIComponent(id)}`);
            }}
          >
            <Field
              label="Open a request by identifier"
              htmlFor="approvals-lookup"
              className="w-full max-w-md"
              hint="Useful when you were sent a link or an approval id rather than finding it in a list."
            >
              <Input
                id="approvals-lookup"
                value={lookup}
                onChange={(event) => setLookup(event.target.value)}
                placeholder="Approval identifier (UUID)"
                className="font-mono"
              />
            </Field>
            <Button type="submit" variant="secondary" disabled={lookup.trim().length === 0}>
              Open request
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-5">
          <Tabs
            aria-label="Approval status"
            value={tab}
            onChange={(next) => {
              setTab(next as ApprovalTab);
              setPage(1);
            }}
            items={APPROVAL_TABS.map((item) => ({ id: item.id, label: item.label, count: counts[item.id] }))}
          >
            {histories.isLoading && rows.length === 0 ? (
              <TableSkeleton rows={6} columns={6} />
            ) : filtered.length === 0 ? (
              <EmptyState
                title={
                  ownerScoped && rows.length === 0
                    ? 'The inbox lists runs you own, and you own none'
                    : tab === 'PENDING'
                      ? 'No approvals are waiting'
                      : `No ${tab.toLowerCase()} approvals`
                }
                description={
                  ownerScoped && rows.length === 0
                    ? 'This inbox is assembled from the runs your account can list, and the API scopes that list to runs you own. Approval requests raised on another analyst’s run are still readable one by one — open the request with the identifier you were given, or follow the link from the run you were asked to review.'
                    : tab === 'PENDING'
                      ? 'When a refund proposal exceeds the policy threshold, the run pauses and its approval request appears here.'
                      : 'No approval request has reached this state for the runs visible to you.'
                }
              />
            ) : (
              <>
                <TableWrapper>
                  <Table>
                    <TableHead>
                      <TableRow className="hover:bg-transparent">
                        <TableHeaderCell>Approval ID</TableHeaderCell>
                        <TableHeaderCell>Run</TableHeaderCell>
                        <TableHeaderCell>Supplier</TableHeaderCell>
                        <TableHeaderCell className="text-right">Amount</TableHeaderCell>
                        <TableHeaderCell>Currency</TableHeaderCell>
                        <TableHeaderCell>Requested</TableHeaderCell>
                        <TableHeaderCell>Expiry</TableHeaderCell>
                        <TableHeaderCell>Decision</TableHeaderCell>
                        <TableHeaderCell className="text-right">Action</TableHeaderCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {visible.map((row) => {
                        const detail = enrichment.details.get(row.approvalId);
                        const supplierLabel = detail?.reviewed.supplierName ?? (row.supplierId ? shortId(row.supplierId) : '—');
                        return (
                          <TableRow key={row.approvalId}>
                            <TableCell className="font-mono text-[12px]">{shortId(row.approvalId)}</TableCell>
                            <TableCell>
                              <Link href={`/runs/${row.runId}`} className="font-mono text-[12px] text-primary hover:underline">
                                {shortId(row.runId)}
                              </Link>
                            </TableCell>
                            <TableCell className="max-w-52 truncate" title={detail?.reviewed.supplierName ?? row.supplierId ?? ''}>
                              {supplierLabel}
                            </TableCell>
                            <TableCell className="tnum text-right font-medium">
                              {row.amountMinor === null ? '—' : formatMoney(row.amountMinor, row.currency ?? 'USD')}
                            </TableCell>
                            <TableCell className="text-muted">{row.currency ?? '—'}</TableCell>
                            <TableCell className="tnum whitespace-nowrap text-muted">{formatDateTime(row.requestedAt)}</TableCell>
                            <TableCell className="whitespace-nowrap text-muted">
                              {row.status === 'PENDING' ? formatCountdown(row.expiresAt) : formatDateTime(row.expiresAt)}
                            </TableCell>
                            <TableCell>
                              <ApprovalStatusBadge status={row.status} size="sm" />
                            </TableCell>
                            <TableCell className="text-right">
                              <Link href={`/approvals/${row.approvalId}`} className="text-sm font-medium text-primary hover:underline">
                                {row.status === 'PENDING' ? 'Review' : 'Open'}
                              </Link>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </TableWrapper>
                {filtered.length > PAGE_SIZE ? (
                  <div className="mt-4 border-t border-border">
                    <Pagination
                      page={currentPage}
                      pageCount={pageCount}
                      totalItems={filtered.length}
                      pageSize={PAGE_SIZE}
                      onPageChange={setPage}
                      itemLabel="approvals"
                    />
                  </div>
                ) : null}
              </>
            )}
          </Tabs>
        </CardContent>
      </Card>

      {histories.total > histories.completed ? (
        <Alert tone="neutral" role="note" title="Some run histories could not be loaded">
          The inbox may be incomplete. It is built from each run&apos;s recorded history because the API exposes approvals individually; reload to
          retry the missing ones.
        </Alert>
      ) : null}
    </div>
  );
}
