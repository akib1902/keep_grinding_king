'use client';

import Link from 'next/link';
import { ExternalLink } from 'lucide-react';
import { RunStatusBadge } from '@/components/data-display/status-badge';
import { EmptyState } from '@/components/data-display/states';
import { CopyableId } from '@/components/data-display/definition-list';
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow, TableWrapper } from '@/components/ui/table';
import { formatDateTime, formatDurationBetween, shortId } from '@/lib/formatters';
import type { Run } from '@/types/api';
import { runRequestSummary } from '../aggregate';

export interface RunsTableProps {
  runs: readonly Run[];
  /** Rendered instead of the table when there is nothing to show. */
  emptyState?: React.ReactNode;
  showOwner?: boolean;
}

/**
 * Research runs table (FDD §7.3, §7.4).
 *
 * Runs are listed from real API responses only; an empty list renders a
 * first-action prompt rather than a blank panel.
 */
export function RunsTable({ runs, emptyState, showOwner = true }: RunsTableProps) {
  if (runs.length === 0) {
    return (
      <>
        {emptyState ?? (
          <EmptyState
            title="No research runs yet"
            description="Submit a research request to start the first analysis of a spending window."
            action={{ label: 'New research run', href: '/runs/new' }}
          />
        )}
      </>
    );
  }

  return (
    <TableWrapper>
      <Table>
        <TableHead>
          <TableRow className="hover:bg-transparent">
            <TableHeaderCell>Run ID</TableHeaderCell>
            <TableHeaderCell>Request</TableHeaderCell>
            {showOwner ? <TableHeaderCell>Owner</TableHeaderCell> : null}
            <TableHeaderCell>Created</TableHeaderCell>
            <TableHeaderCell>Status</TableHeaderCell>
            <TableHeaderCell>Duration</TableHeaderCell>
            <TableHeaderCell className="text-right">Actions</TableHeaderCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {runs.map((run) => {
            return (
              <TableRow key={run.runId}>
                <TableCell>
                  <CopyableId value={run.runId} label="run id" />
                </TableCell>
                <TableCell className="max-w-md min-w-56">
                  <span className="line-clamp-2 text-foreground">{runRequestSummary(run)}</span>
                  <span className="mt-0.5 block font-mono text-[11px] text-muted">
                    {run.request.from} → {run.request.to} · {run.request.currency}
                  </span>
                </TableCell>
                {showOwner ? (
                  <TableCell className="font-mono text-[12px] text-muted" title={run.ownerId}>
                    {shortId(run.ownerId)}
                  </TableCell>
                ) : null}
                <TableCell className="tnum whitespace-nowrap text-muted">{formatDateTime(run.createdAt)}</TableCell>
                <TableCell>
                  <RunStatusBadge status={run.status} />
                </TableCell>
                <TableCell className="tnum whitespace-nowrap text-muted">
                  {run.startedAt ? formatDurationBetween(run.startedAt, run.completedAt) : '—'}
                </TableCell>
                <TableCell className="text-right">
                  <Link
                    href={`/runs/${run.runId}`}
                    className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
                  >
                    Open
                    <ExternalLink aria-hidden="true" className="size-3.5" />
                  </Link>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </TableWrapper>
  );
}
