'use client';

import { Suspense, useMemo, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Info, Search } from 'lucide-react';
import { PageHeader } from '@/components/layout/page-header';
import { Alert } from '@/components/ui/alert';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, Input, Select } from '@/components/ui/field';
import { TableSkeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow, TableWrapper } from '@/components/ui/table';
import { SettlementStatusBadge } from '@/components/data-display/status-badge';
import { EmptyState, ErrorState } from '@/components/data-display/states';
import { Pagination, pageCountFor, pageSlice } from '@/components/data-display/pagination';
import { useRuns, useRunHistories } from '@/features/runs/hooks';
import { runsWithApprovalHistory } from '@/features/runs/aggregate';
import { buildLedgerRows, filterLedgerRows, isCommittedLedgerEntry } from '@/features/ledger/rows';
import { useLedgerOperation, useLedgerOperationDetails } from '@/features/proposals/hooks';
import { CopyableId, DefinitionList } from '@/components/data-display/definition-list';
import { formatDateTime, formatMoney, shortId } from '@/lib/formatters';

const PAGE_SIZE = 15;
const SETTLEMENT_STATUSES = ['PENDING', 'COMMITTED', 'FAILED', 'UNKNOWN'] as const;

/**
 * Settlement ledger (FDD §7.8).
 *
 * Only backend-confirmed settlement operations appear. Rows on the visible page
 * are enriched with the authoritative operation record, which is where the commit
 * timestamp and ledger entry hash live. A pending or approved proposal is never
 * rendered as a settled entry.
 */
export default function LedgerPage() {
  return (
    <Suspense
      fallback={
        <div className="flex flex-col gap-6">
          <PageHeader title="Settlement Ledger" />
          <Card>
            <TableSkeleton rows={8} columns={5} />
          </Card>
        </div>
      }
    >
      <LedgerPageContent />
    </Suspense>
  );
}

function LedgerPageContent() {
  const searchParams = useSearchParams();
  const [status, setStatus] = useState<string>('ALL');
  const [query, setQuery] = useState(searchParams.get('operationId') ?? '');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);

  const runsQuery = useRuns();
  const candidates = useMemo(() => runsWithApprovalHistory(runsQuery.data ?? []).slice(0, 50), [runsQuery.data]);
  const histories = useRunHistories(candidates);

  const rows = useMemo(() => buildLedgerRows(runsQuery.data ?? [], histories.entries), [runsQuery.data, histories.entries]);
  const filtered = useMemo(
    () => filterLedgerRows(rows, { status: status as 'ALL' | (typeof SETTLEMENT_STATUSES)[number], query, from, to }),
    [rows, status, query, from, to],
  );

  const pageCount = pageCountFor(filtered.length, PAGE_SIZE);
  const currentPage = Math.min(page, pageCount);
  const visible = pageSlice(filtered, currentPage, PAGE_SIZE);
  const operations = useLedgerOperationDetails(visible.map((row) => row.operationId));

  // A settlement operation can also be looked up directly by id, which is how an
  // approver (whose account owns no runs) reaches one that was quoted to them.
  const trimmedQuery = query.trim();
  const looksLikeOperationId = /^[0-9a-f-]{8,}$/i.test(trimmedQuery) || trimmedQuery.startsWith('op_');
  const directLookup = useLedgerOperation(
    looksLikeOperationId && filtered.length === 0 ? trimmedQuery : null,
  );

  const committedCount = rows.filter(isCommittedLedgerEntry).length;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Settlement Ledger"
        description="Simulated settlement operations recorded by the backend. Each committed operation corresponds to exactly one ledger entry, written once."
      />

      <Alert tone="info" role="note" title="Simulated settlement">
        <p className="flex items-start gap-2">
          <Info aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
          <span>
            No real funds are transferred by this system in any environment. Every entry below is labelled simulated by the backend, and the
            console repeats that label wherever an amount is shown.
          </span>
        </p>
      </Alert>

      {runsQuery.isError ? (
        <ErrorState error={runsQuery.error} onRetry={() => void runsQuery.refetch()} title="The run list could not be loaded" />
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Filters</CardTitle>
          <span className="text-xs text-muted">
            {rows.length} operation(s) · {committedCount} committed
          </span>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Search" htmlFor="ledger-search" hint="Operation, run, proposal or ledger entry id.">
            <div className="relative">
              <Search aria-hidden="true" className="pointer-events-none absolute top-2.5 left-3 size-4 text-muted" />
              <Input
                id="ledger-search"
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setPage(1);
                }}
                placeholder="Search operations…"
                className="pl-9"
              />
            </div>
          </Field>
          <Field label="Status" htmlFor="ledger-status">
            <Select
              id="ledger-status"
              value={status}
              onChange={(event) => {
                setStatus(event.target.value);
                setPage(1);
              }}
            >
              <option value="ALL">All statuses</option>
              {SETTLEMENT_STATUSES.map((value) => (
                <option key={value} value={value}>
                  {value.toLowerCase()}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Requested from" htmlFor="ledger-from">
            <Input
              id="ledger-from"
              type="date"
              value={from}
              onChange={(event) => {
                setFrom(event.target.value);
                setPage(1);
              }}
            />
          </Field>
          <Field label="Requested to" htmlFor="ledger-to">
            <Input
              id="ledger-to"
              type="date"
              value={to}
              onChange={(event) => {
                setTo(event.target.value);
                setPage(1);
              }}
            />
          </Field>
        </CardContent>
      </Card>

      <Card>
        {histories.isLoading && rows.length === 0 ? (
          <TableSkeleton rows={8} columns={7} />
        ) : filtered.length === 0 && directLookup.data ? (
          <div className="flex flex-col gap-4 p-5">
            <p className="text-sm text-muted">
              No listed settlement operation matched, but the identifier you entered resolves to a recorded operation. It is shown directly from the
              settlement endpoint.
            </p>
            <DefinitionList
              columns={2}
              items={[
                { term: 'Operation id', value: <CopyableId value={directLookup.data.operationId} label="operation id" /> },
                { term: 'Status', value: <SettlementStatusBadge status={directLookup.data.status} size="sm" /> },
                { term: 'Attempts', value: String(directLookup.data.attempts), mono: true },
                { term: 'Committed', value: directLookup.data.committedAt ?? 'not committed', mono: true },
                {
                  term: 'Amount (simulated)',
                  value: directLookup.data.ledgerEntry
                    ? formatMoney(directLookup.data.ledgerEntry.amountMinor, directLookup.data.ledgerEntry.currency)
                    : 'no ledger entry',
                },
                { term: 'Ledger entry', value: directLookup.data.ledgerEntry?.ledgerEntryId ?? '—', mono: true },
                { term: 'Source proposal', value: <Link href={`/refund-proposals/${directLookup.data.proposalId}`} className="font-mono text-primary hover:underline">{directLookup.data.proposalId}</Link> },
                { term: 'Source run', value: <Link href={`/runs/${directLookup.data.runId}`} className="font-mono text-primary hover:underline">{directLookup.data.runId}</Link> },
                { term: 'Last error', value: directLookup.data.lastError ?? '—' },
              ]}
            />
          </div>
        ) : filtered.length === 0 && directLookup.isPending && looksLikeOperationId ? (
          <TableSkeleton rows={3} columns={4} />
        ) : filtered.length === 0 && directLookup.isError && looksLikeOperationId ? (
          <ErrorState
            error={directLookup.error}
            title="No settlement operation matches that identifier"
            context="Either the identifier is not a settlement operation id, or it does not exist in your tenant."
          />
        ) : filtered.length === 0 ? (
          <EmptyState
            title="No settlement operations match"
            description="A settlement operation appears only after an authorised proposal is approved and the simulated settlement commits. Approvals are shown in the approvals inbox."
            action={{ label: 'Open approvals inbox', href: '/approvals' }}
          />
        ) : (
          <>
            <TableWrapper>
              <Table>
                <TableHead>
                  <TableRow className="hover:bg-transparent">
                    <TableHeaderCell>Operation ID</TableHeaderCell>
                    <TableHeaderCell>Supplier</TableHeaderCell>
                    <TableHeaderCell className="text-right">Amount</TableHeaderCell>
                    <TableHeaderCell>Currency</TableHeaderCell>
                    <TableHeaderCell>Settled at</TableHeaderCell>
                    <TableHeaderCell>Source proposal</TableHeaderCell>
                    <TableHeaderCell>Run</TableHeaderCell>
                    <TableHeaderCell>Status</TableHeaderCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {visible.map((row) => {
                    // Supplier, proposal and amount are resolved from the
                    // authoritative operation record for the visible page, rather
                    // than guessed from the run list.
                    const operation = operations.operations.get(row.operationId);
                    const supplierId = row.supplierId ?? operation?.ledgerEntry?.supplierId ?? null;
                    const proposalId = row.proposalId ?? operation?.proposalId ?? null;
                    const amountMinor = row.amountMinor ?? operation?.ledgerEntry?.amountMinor ?? null;
                    const currency = row.currency ?? operation?.ledgerEntry?.currency ?? null;
                    return (
                      <TableRow key={row.operationId}>
                        <TableCell className="font-mono text-[12px]">{shortId(row.operationId)}</TableCell>
                        <TableCell className="font-mono text-[12px] text-muted" title={supplierId ?? ''}>
                          {supplierId ? shortId(supplierId) : operations.isLoading ? '…' : '—'}
                        </TableCell>
                        <TableCell className="tnum text-right font-medium">
                          {amountMinor === null ? '—' : formatMoney(amountMinor, currency ?? 'USD')}
                          <span className="ml-1.5 text-[10px] tracking-wide text-muted uppercase">sim</span>
                        </TableCell>
                        <TableCell className="text-muted">{currency ?? '—'}</TableCell>
                        <TableCell className="tnum whitespace-nowrap text-muted">
                          {operation?.committedAt ? formatDateTime(operation.committedAt) : operations.isLoading ? 'loading…' : 'not committed'}
                        </TableCell>
                        <TableCell>
                          {proposalId ? (
                            <Link href={`/refund-proposals/${proposalId}`} className="font-mono text-[12px] text-primary hover:underline">
                              {shortId(proposalId)}
                            </Link>
                          ) : (
                            <span className="text-xs text-muted">—</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <Link href={`/runs/${row.runId}`} className="font-mono text-[12px] text-primary hover:underline">
                            {shortId(row.runId)}
                          </Link>
                        </TableCell>
                        <TableCell>
                          <SettlementStatusBadge status={row.status} size="sm" />
                        </TableCell>
                      </TableRow>
                    );
                  })}
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
                  itemLabel="operations"
                />
              </div>
            ) : null}
          </>
        )}
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Committed ledger entries on this page</CardTitle>
          <span className="text-xs text-muted">Read from the authoritative settlement operation endpoint.</span>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {visible.filter((row) => isCommittedLedgerEntry(row)).length === 0 ? (
            <p className="text-sm text-muted">No committed ledger entry is present on this page.</p>
          ) : (
            <ul className="flex flex-col divide-y divide-border">
              {visible
                .filter((row) => isCommittedLedgerEntry(row))
                .map((row) => {
                  const operation = operations.operations.get(row.operationId);
                  const entry = operation?.ledgerEntry ?? null;
                  return (
                    <li key={row.operationId} className="flex flex-col gap-1 py-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="tnum text-sm font-medium text-foreground">
                          {entry
                            ? formatMoney(entry.amountMinor, entry.currency)
                            : row.amountMinor === null
                              ? '—'
                              : formatMoney(row.amountMinor, row.currency ?? 'USD')}
                          <span className="ml-2 text-[10px] tracking-wide text-muted uppercase">simulated</span>
                        </span>
                        <span className="font-mono text-xs text-muted">{row.operationId}</span>
                      </div>
                      {entry ? (
                        <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-muted">
                          <span>ledger entry {shortId(entry.ledgerEntryId, 12)}</span>
                          <span>type {entry.entryType}</span>
                          <span>hash {entry.entryHash.slice(0, 16)}</span>
                          <span>created {formatDateTime(entry.createdAt)}</span>
                          {entry.memo ? <span>memo “{entry.memo}”</span> : null}
                        </div>
                      ) : (
                        <p className="text-xs text-muted">Loading the ledger entry…</p>
                      )}
                    </li>
                  );
                })}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
