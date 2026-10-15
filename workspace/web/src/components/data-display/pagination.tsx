'use client';

import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';

export interface PaginationProps {
  page: number;
  pageCount: number;
  totalItems: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  /** Label for the items being paged, e.g. "runs". */
  itemLabel?: string;
}

/**
 * Pagination against a bounded result set (FDD §11: list endpoints are used
 * within their limits, and the console pages the result rather than downloading
 * an unbounded dataset).
 */
export function Pagination({ page, pageCount, totalItems, pageSize, onPageChange, itemLabel = 'items' }: PaginationProps) {
  const safePageCount = Math.max(1, pageCount);
  const from = totalItems === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(totalItems, page * pageSize);
  return (
    <nav aria-label={`Pagination for ${itemLabel}`} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
      <p className="tnum text-xs text-muted">
        Showing {from}–{to} of {totalItems} {itemLabel}
      </p>
      <div className="flex items-center gap-1">
        <Button
          variant="secondary"
          size="sm"
          onClick={() => onPageChange(page - 1)}
          disabled={page <= 1}
          aria-label={`Previous page of ${itemLabel}`}
        >
          <ChevronLeft />
          Previous
        </Button>
        <span className="tnum px-2 text-xs text-muted">
          Page {page} of {safePageCount}
        </span>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => onPageChange(page + 1)}
          disabled={page >= safePageCount}
          aria-label={`Next page of ${itemLabel}`}
        >
          Next
          <ChevronRight />
        </Button>
      </div>
    </nav>
  );
}

/** Clamps a page number and slices the bounded set. */
export function pageSlice<T>(items: readonly T[], page: number, pageSize: number): T[] {
  const start = Math.max(0, (page - 1) * pageSize);
  return items.slice(start, start + pageSize);
}

export function pageCountFor(totalItems: number, pageSize: number): number {
  return Math.max(1, Math.ceil(totalItems / pageSize));
}
