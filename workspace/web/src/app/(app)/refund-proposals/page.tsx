'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Search } from 'lucide-react';
import { PageHeader } from '@/components/layout/page-header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, Input, Select } from '@/components/ui/field';
import { TableSkeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow, TableWrapper } from '@/components/ui/table';
import { ApprovalStatusBadge, ProposalStatusBadge } from '@/components/data-display/status-badge';
import { EmptyState, ErrorState } from '@/components/data-display/states';
import { OwnerScopedListNotice } from '@/components/data-display/scope-notice';
import { useSession } from '@/features/auth/session-provider';
import { Pagination, pageCountFor, pageSlice } from '@/components/data-display/pagination';
import { useRuns, useRunHistories } from '@/features/runs/hooks';
import { runsWithApprovalHistory } from '@/features/runs/aggregate';
import { buildProposalRows, filterProposalRows } from '@/features/proposals/rows';
import { formatDateTime, formatMoney, shortId } from '@/lib/formatters';

const PAGE_SIZE = 15;
const STATUSES = ['REQUIRES_APPROVAL', 'POLICY_DENIED', 'APPROVED', 'REJECTED', 'EXPIRED', 'CANCELLED', 'SETTLED'] as const;

/**
 * Refund proposal list (FDD §7.7).
 *
 * Covers every proposal state, including proposals the policy engine denied and
 * proposals that expired — the two cases most easily hidden by a UI that only
 * shows the happy path.
 */
export default function RefundProposalsPage() {
  const { role } = useSession();
  const [status, setStatus] = useState<string>('ALL');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);

  const runsQuery = useRuns();
  const candidates = useMemo(() => runsWithApprovalHistory(runsQuery.data ?? []).slice(0, 50), [runsQuery.data]);
  const histories = useRunHistories(candidates);

  const rows = useMemo(() => buildProposalRows(histories.entries), [histories.entries]);
  const filtered = useMemo(
    () => filterProposalRows(rows, status as 'ALL' | (typeof STATUSES)[number], query),
    [rows, status, query],
  );
  const pageCount = pageCountFor(filtered.length, PAGE_SIZE);
  const currentPage = Math.min(page, pageCount);
  const visible = pageSlice(filtered, currentPage, PAGE_SIZE);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Refund Proposals"
        description="Every refund proposal recorded for the runs visible to you, with its policy outcome, approval state and settlement state kept distinct."
      />

      {runsQuery.isError ? (
        <ErrorState error={runsQuery.error} onRetry={() => void runsQuery.refetch()} title="The run list could not be loaded" />
      ) : null}

      {role === 'APPROVER' ? (
        <OwnerScopedListNotice
          view="Refund Proposals"
          alternative={{ label: 'open the proposal from the approval you are reviewing', href: '/approvals' }}
        />
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Filters</CardTitle>
          <span className="text-xs text-muted">{rows.length} proposal(s) across {histories.completed} loaded run histories</span>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-[1fr_2fr]">
          <Field label="Status" htmlFor="proposals-status">
            <Select
              id="proposals-status"
              value={status}
              onChange={(event) => {
                setStatus(event.target.value);
                setPage(1);
              }}
            >
              <option value="ALL">All statuses</option>
              {STATUSES.map((value) => (
                <option key={value} value={value}>
                  {value.replace(/_/g, ' ').toLowerCase()}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Search" htmlFor="proposals-search" hint="Matches proposal, run, supplier or transaction identifiers.">
            <div className="relative">
              <Search aria-hidden="true" className="pointer-events-none absolute top-2.5 left-3 size-4 text-muted" />
              <Input
                id="proposals-search"
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setPage(1);
                }}
                placeholder="Search proposals…"
                className="pl-9"
              />
            </div>
          </Field>
        </CardContent>
      </Card>

      <Card>
        {histories.isLoading && rows.length === 0 ? (
          <TableSkeleton rows={8} columns={6} />
        ) : filtered.length === 0 ? (
          <EmptyState
            title="No refund proposals match"
            description="A proposal appears here only when the workflow actually created one. A policy refusal is recorded on the audit trail without a proposal row."
            action={{ label: 'Open the audit trail', href: '/audit' }}
          />
        ) : (
          <>
            <TableWrapper>
              <Table>
                <TableHead>
                  <TableRow className="hover:bg-transparent">
                    <TableHeaderCell>Proposal</TableHeaderCell>
                    <TableHeaderCell>Run</TableHeaderCell>
                    <TableHeaderCell>Supplier</TableHeaderCell>
                    <TableHeaderCell className="text-right">Proposed amount</TableHeaderCell>
                    <TableHeaderCell>Policy</TableHeaderCell>
                    <TableHeaderCell>Proposal status</TableHeaderCell>
                    <TableHeaderCell>Approval</TableHeaderCell>
                    <TableHeaderCell>Created</TableHeaderCell>
                    <TableHeaderCell className="text-right">Action</TableHeaderCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {visible.map((row) => (
                    <TableRow key={row.proposalId}>
                      <TableCell className="font-mono text-[12px]">{shortId(row.proposalId)}</TableCell>
                      <TableCell>
                        <Link href={`/runs/${row.runId}`} className="font-mono text-[12px] text-primary hover:underline">
                          {shortId(row.runId)}
                        </Link>
                      </TableCell>
                      <TableCell className="font-mono text-[12px] text-muted" title={row.supplierId}>
                        {shortId(row.supplierId)}
                      </TableCell>
                      <TableCell className="tnum text-right font-medium">{formatMoney(row.amountMinor, row.currency)}</TableCell>
                      <TableCell className="text-xs text-muted">
                        {row.policyVersion} · {row.policyOutcome}
                      </TableCell>
                      <TableCell>
                        <ProposalStatusBadge status={row.status} size="sm" />
                      </TableCell>
                      <TableCell>
                        {row.approvalStatus ? <ApprovalStatusBadge status={row.approvalStatus} size="sm" /> : <span className="text-xs text-muted">—</span>}
                      </TableCell>
                      <TableCell className="tnum whitespace-nowrap text-muted">{formatDateTime(row.createdAt)}</TableCell>
                      <TableCell className="text-right">
                        <Link href={`/refund-proposals/${row.proposalId}`} className="text-sm font-medium text-primary hover:underline">
                          Open
                        </Link>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableWrapper>
            {filtered.length > PAGE_SIZE ? (
              <div className="border-t border-border">
                <Pagination
                  page={currentPage}
                  pageCount={pageCount}
                  totalItems={filtered.length}
                  pageSize={PAGE_SIZE}
                  onPageChange={setPage}
                  itemLabel="proposals"
                />
              </div>
            ) : null}
          </>
        )}
      </Card>

      <p className="text-xs text-muted">
        Supplier names are shown where the API exposes them (they appear on an approval snapshot). Otherwise only the supplier identifier is
        available, and the console shows the identifier rather than guessing a name. Settlement detail — operation id, ledger entry and commit
        time — is shown on the proposal detail page, where the API provides it authoritatively.
      </p>
    </div>
  );
}
