'use client';

import { Suspense, useMemo, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Plus, Search } from 'lucide-react';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, Input, Select } from '@/components/ui/field';
import { TableSkeleton } from '@/components/ui/skeleton';
import { ErrorState } from '@/components/data-display/states';
import { Pagination, pageCountFor, pageSlice } from '@/components/data-display/pagination';
import { RunsTable } from '@/features/runs/components/runs-table';
import { useRuns } from '@/features/runs/hooks';
import { filterRuns, sortRunsByCreatedDesc, summarizeRuns } from '@/features/runs/aggregate';
import { RUN_STATUSES } from '@/types/api';
import { runStatusMeta } from '@/lib/status';

const PAGE_SIZE = 12;

export default function RunsPage() {
  return (
    // `useSearchParams` needs a Suspense boundary so the route can still be
    // prerendered; the fallback keeps the table's shape while it resolves.
    <Suspense
      fallback={
        <div className="flex flex-col gap-6">
          <PageHeader title="Research Runs" />
          <Card>
            <TableSkeleton rows={8} columns={5} />
          </Card>
        </div>
      }
    >
      <RunsPageContent />
    </Suspense>
  );
}

function RunsPageContent() {
  const searchParams = useSearchParams();
  const initialStatus = searchParams.get('status') ?? 'ALL';
  const [status, setStatus] = useState<string>(
    (RUN_STATUSES as readonly string[]).includes(initialStatus) ? initialStatus : 'ALL',
  );
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);

  const runsQuery = useRuns();
  const sorted = useMemo(() => sortRunsByCreatedDesc(runsQuery.data ?? []), [runsQuery.data]);
  const filtered = useMemo(
    () => filterRuns(sorted, { status: status as 'ALL' | (typeof RUN_STATUSES)[number], query }),
    [sorted, status, query],
  );
  const summary = useMemo(() => summarizeRuns(sorted), [sorted]);

  const pageCount = pageCountFor(filtered.length, PAGE_SIZE);
  const currentPage = Math.min(page, pageCount);
  const visible = pageSlice(filtered, currentPage, PAGE_SIZE);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Research Runs"
        description="Every run visible to your role. Filtering, searching and paging are applied to the bounded set returned by the API."
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
        <ErrorState error={runsQuery.error} onRetry={() => void runsQuery.refetch()} title="The run list could not be loaded" />
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Filters</CardTitle>
          <span className="text-xs text-muted">
            {summary.total} total · {summary.active} active · {summary.awaitingApproval} awaiting approval
          </span>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-[1fr_2fr]">
          <Field label="Status" htmlFor="runs-status">
            <Select
              id="runs-status"
              value={status}
              onChange={(event) => {
                setStatus(event.target.value);
                setPage(1);
              }}
            >
              <option value="ALL">All statuses</option>
              {RUN_STATUSES.map((value) => (
                <option key={value} value={value}>
                  {runStatusMeta(value).label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Search" htmlFor="runs-search" hint="Matches the run identifier or the request text.">
            <div className="relative">
              <Search aria-hidden="true" className="pointer-events-none absolute top-2.5 left-3 size-4 text-muted" />
              <Input
                id="runs-search"
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setPage(1);
                }}
                placeholder="Search runs…"
                className="pl-9"
              />
            </div>
          </Field>
        </CardContent>
      </Card>

      <Card>
        {runsQuery.isPending ? (
          <TableSkeleton rows={8} columns={5} />
        ) : (
          <>
            <RunsTable
              runs={visible}
              emptyState={
                <div className="px-6 py-12 text-center">
                  <p className="text-sm font-medium text-foreground">No runs match these filters</p>
                  <p className="mt-1 text-sm text-muted">
                    {sorted.length === 0
                      ? 'Nothing has been submitted yet for this account.'
                      : 'Clear the search box or choose a different status to see more.'}
                  </p>
                  {sorted.length === 0 ? (
                    <Link
                      href="/runs/new"
                      className="mt-4 inline-flex h-9 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary-hover"
                    >
                      New research run
                    </Link>
                  ) : (
                    <Button
                      variant="secondary"
                      size="sm"
                      className="mt-4"
                      onClick={() => {
                        setQuery('');
                        setStatus('ALL');
                      }}
                    >
                      Clear filters
                    </Button>
                  )}
                </div>
              }
            />
            {filtered.length > PAGE_SIZE ? (
              <div className="border-t border-border">
                <Pagination
                  page={currentPage}
                  pageCount={pageCount}
                  totalItems={filtered.length}
                  pageSize={PAGE_SIZE}
                  onPageChange={setPage}
                  itemLabel="runs"
                />
              </div>
            ) : null}
          </>
        )}
      </Card>

      <p className="text-xs text-muted">
        The API returns at most 100 runs per request, newest first. Owner is shown as an identifier because the API exposes owner ids, not names.
      </p>
    </div>
  );
}
