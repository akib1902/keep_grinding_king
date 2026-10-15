'use client';

import { Fragment, useMemo, useState } from 'react';
import Link from 'next/link';
import { Search } from 'lucide-react';
import { PageHeader } from '@/components/layout/page-header';
import { Alert } from '@/components/ui/alert';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Field, Input, Select } from '@/components/ui/field';
import { TableSkeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow, TableWrapper } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { EmptyState, ErrorState } from '@/components/data-display/states';
import { OwnerScopedListNotice } from '@/components/data-display/scope-notice';
import { useSession } from '@/features/auth/session-provider';
import { Pagination, pageCountFor, pageSlice } from '@/components/data-display/pagination';
import { PayloadBlock } from '@/components/data-display/timeline';
import { useRuns, useRunAudits } from '@/features/runs/hooks';
import { AUDIT_CATEGORY_GROUPS, buildAuditRows, distinctActorTypes, filterAuditRows } from '@/features/audit/rows';
import { formatDateTime, shortId } from '@/lib/formatters';
import { auditActionLabel } from '@/lib/status';

const PAGE_SIZE = 20;

const ACTOR_TYPES = ['ALL', 'USER', 'AGENT', 'SYSTEM'] as const;

/**
 * Audit trail (FDD §7.9).
 *
 * A reader over the records the backend wrote, across every run the user can see.
 * The page states plainly that rendering a timeline here is not itself
 * tamper-proof storage: integrity is the backend's responsibility.
 */
export default function AuditPage() {
  const { role } = useSession();
  const [action, setAction] = useState<string>('ALL');
  const [actorType, setActorType] = useState<string>('ALL');
  const [runId, setRunId] = useState('');
  const [operationId, setOperationId] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [expanded, setExpanded] = useState<string | null>(null);

  const runsQuery = useRuns();
  const audits = useRunAudits(runsQuery.data);

  const rows = useMemo(() => buildAuditRows(audits.entries), [audits.entries]);
  const actors = useMemo(() => distinctActorTypes(rows), [rows]);
  const filtered = useMemo(
    () => filterAuditRows(rows, { action, actorType, runId, operationId, from, to, query }),
    [rows, action, actorType, runId, operationId, from, to, query],
  );

  const pageCount = pageCountFor(filtered.length, PAGE_SIZE);
  const currentPage = Math.min(page, pageCount);
  const visible = pageSlice(filtered, currentPage, PAGE_SIZE);

  const reset = (): void => {
    setAction('ALL');
    setActorType('ALL');
    setRunId('');
    setOperationId('');
    setFrom('');
    setTo('');
    setQuery('');
    setPage(1);
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Audit Trail"
        description="Chronological record of workflow and financial decisions across the runs visible to you."
      />

      <Alert tone="neutral" role="note" title="About this view">
        This page reads the audit records the backend wrote; it does not create or edit them. Rendering them as a timeline here does not make this
        view tamper-proof — audit integrity is enforced by the backend, and this console is not an authority on it.
      </Alert>

      {runsQuery.isError ? (
        <ErrorState error={runsQuery.error} onRetry={() => void runsQuery.refetch()} title="The run list could not be loaded" />
      ) : null}

      {role === 'APPROVER' ? (
        <OwnerScopedListNotice view="Audit Trail" alternative={{ label: 'open the approval you were asked to review', href: '/approvals' }} />
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Filters</CardTitle>
          <span className="text-xs text-muted">
            {rows.length} record(s) across {audits.entries.length} run(s)
          </span>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Event category" htmlFor="audit-action">
            <Select
              id="audit-action"
              value={action}
              onChange={(event) => {
                setAction(event.target.value);
                setPage(1);
              }}
            >
              <option value="ALL">All events</option>
              {Object.keys(AUDIT_CATEGORY_GROUPS).map((group) => (
                <option key={group} value={group}>
                  {group}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Actor" htmlFor="audit-actor">
            <Select
              id="audit-actor"
              value={actorType}
              onChange={(event) => {
                setActorType(event.target.value);
                setPage(1);
              }}
            >
              {ACTOR_TYPES.filter((value) => value === 'ALL' || actors.includes(value)).map((value) => (
                <option key={value} value={value}>
                  {value === 'ALL' ? 'All actors' : value}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Run id" htmlFor="audit-run" hint="Partial identifiers are accepted.">
            <Input
              id="audit-run"
              value={runId}
              onChange={(event) => {
                setRunId(event.target.value);
                setPage(1);
              }}
              placeholder="e.g. 38b4e0e4"
            />
          </Field>
          <Field label="Operation id" htmlFor="audit-operation" hint="Settlement operation references.">
            <Input
              id="audit-operation"
              value={operationId}
              onChange={(event) => {
                setOperationId(event.target.value);
                setPage(1);
              }}
              placeholder="op_…"
            />
          </Field>
          <Field label="From" htmlFor="audit-from">
            <Input
              id="audit-from"
              type="date"
              value={from}
              onChange={(event) => {
                setFrom(event.target.value);
                setPage(1);
              }}
            />
          </Field>
          <Field label="To" htmlFor="audit-to">
            <Input
              id="audit-to"
              type="date"
              value={to}
              onChange={(event) => {
                setTo(event.target.value);
                setPage(1);
              }}
            />
          </Field>
          <Field label="Search" htmlFor="audit-search" className="lg:col-span-2">
            <div className="relative">
              <Search aria-hidden="true" className="pointer-events-none absolute top-2.5 left-3 size-4 text-muted" />
              <Input
                id="audit-search"
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setPage(1);
                }}
                placeholder="Search events…"
                className="pl-9"
              />
            </div>
          </Field>
          <div className="flex items-end">
            <Button variant="secondary" onClick={reset}>
              Clear filters
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        {audits.isLoading && rows.length === 0 ? (
          <TableSkeleton rows={10} columns={4} />
        ) : filtered.length === 0 ? (
          <EmptyState
            title="No audit records match"
            description={
              role === 'APPROVER'
                ? 'Your role can read an approval and the decisions recorded against it, but the audit trail of the underlying run stays scoped to its owner. Decisions you record are still written to that trail by the backend and are visible in the approval detail.'
                : 'Audit records are created by the backend as the workflow runs. Clear the filters, or submit a run to generate activity.'
            }
            action={role === 'APPROVER' ? { label: 'Open approvals inbox', href: '/approvals' } : { label: 'New research run', href: '/runs/new' }}
          />
        ) : (
          <>
            <TableWrapper>
              <Table>
                <TableHead>
                  <TableRow className="hover:bg-transparent">
                    <TableHeaderCell>Timestamp</TableHeaderCell>
                    <TableHeaderCell>Event</TableHeaderCell>
                    <TableHeaderCell>Actor</TableHeaderCell>
                    <TableHeaderCell>Target</TableHeaderCell>
                    <TableHeaderCell>Run</TableHeaderCell>
                    <TableHeaderCell className="text-right">Detail</TableHeaderCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {visible.map((row) => (
                    <Fragment key={row.auditId}>
                      <TableRow>
                        <TableCell className="tnum whitespace-nowrap text-muted">{formatDateTime(row.createdAt)}</TableCell>
                        <TableCell>
                          <span className="text-sm text-foreground">{auditActionLabel(row.action)}</span>
                          <span className="mt-0.5 block font-mono text-[11px] text-muted">{row.action}</span>
                        </TableCell>
                        <TableCell>
                          <Badge tone={row.actorType === 'USER' ? 'info' : row.actorType === 'AGENT' ? 'neutral' : 'success'} size="sm">
                            {row.actorType}
                          </Badge>
                          {row.actorId ? <span className="mt-1 block font-mono text-[11px] text-muted">{shortId(row.actorId, 16)}</span> : null}
                        </TableCell>
                        <TableCell className="text-xs text-muted">
                          {row.targetType ? (
                            <>
                              {row.targetType}
                              {row.targetId ? <span className="mt-0.5 block font-mono">{shortId(row.targetId)}</span> : null}
                            </>
                          ) : (
                            '—'
                          )}
                        </TableCell>
                        <TableCell>
                          <Link href={`/runs/${row.runId}`} className="font-mono text-[12px] text-primary hover:underline">
                            {shortId(row.runId)}
                          </Link>
                        </TableCell>
                        <TableCell className="text-right">
                          {row.metadata ? (
                            <Button
                              variant="ghost"
                              size="sm"
                              aria-expanded={expanded === row.auditId}
                              onClick={() => setExpanded(expanded === row.auditId ? null : row.auditId)}
                            >
                              {expanded === row.auditId ? 'Hide' : 'Show'}
                            </Button>
                          ) : (
                            <span className="text-xs text-muted">—</span>
                          )}
                        </TableCell>
                      </TableRow>
                      {expanded === row.auditId && row.metadata ? (
                        <TableRow className="hover:bg-transparent">
                          <TableCell colSpan={6} className="bg-surface-muted">
                            <PayloadBlock value={row.metadata} />
                          </TableCell>
                        </TableRow>
                      ) : null}
                    </Fragment>
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
                  itemLabel="records"
                />
              </div>
            ) : null}
          </>
        )}
      </Card>
    </div>
  );
}
