'use client';

import { useId, useState, type ReactNode } from 'react';
import { CheckCircle2, ChevronDown, CircleDashed, MinusCircle, XCircle } from 'lucide-react';
import { cn } from '@/lib/cn';
import { formatDateTime, formatDurationMs } from '@/lib/formatters';
import { stepStatusMeta } from '@/lib/status';

export interface TimelineEntry {
  id: string;
  title: string;
  status: string;
  /** Right-aligned metadata, e.g. a duration or tool name. */
  meta?: string;
  timestamp?: string | null;
  description?: ReactNode;
  /** Expandable technical detail (step payload, error code). */
  detail?: ReactNode;
  tone?: 'default' | 'muted';
}

const ICONS = {
  success: CheckCircle2,
  danger: XCircle,
  info: CircleDashed,
  neutral: MinusCircle,
} as const;

const ICON_CLASS = {
  success: 'text-success',
  danger: 'text-danger',
  info: 'text-info',
  neutral: 'text-muted',
} as const;

/**
 * Vertical execution timeline (FDD §7.4B, §7.4E). Each row communicates its state
 * through an icon, a colour and the status label text, and expands to show the
 * raw step payload for operators.
 */
export function ExecutionTimeline({ entries, className }: { entries: readonly TimelineEntry[]; className?: string }) {
  return (
    <ol className={cn('flex flex-col', className)}>
      {entries.map((entry, index) => (
        <TimelineRow key={entry.id} entry={entry} last={index === entries.length - 1} />
      ))}
    </ol>
  );
}

function TimelineRow({ entry, last }: { entry: TimelineEntry; last: boolean }) {
  const [open, setOpen] = useState(false);
  const detailId = useId();
  const meta = stepStatusMeta(entry.status);
  const tone = entry.tone === 'muted' ? 'neutral' : meta.tone === 'warning' ? 'danger' : meta.tone;
  const Icon = ICONS[tone];
  const hasDetail = entry.detail !== undefined && entry.detail !== null;

  return (
    <li className="flex gap-3">
      <div className="flex flex-col items-center pt-0.5">
        <Icon aria-hidden="true" className={cn('size-4 shrink-0', ICON_CLASS[tone])} />
        {!last ? <span aria-hidden="true" className="mt-1 w-px flex-1 bg-border" /> : null}
      </div>
      <div className={cn('flex min-w-0 flex-1 flex-col gap-1', last ? 'pb-0' : 'pb-5')}>
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <p className="text-sm font-medium text-foreground">{entry.title}</p>
          {entry.meta ? <p className="tnum text-xs text-muted">{entry.meta}</p> : null}
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
          {/* The label is always rendered, so the state is not colour-only. */}
          <span>{meta.label}</span>
          {entry.timestamp ? <time dateTime={entry.timestamp}>{formatDateTime(entry.timestamp)}</time> : null}
        </div>
        {entry.description ? <div className="text-sm text-secondary">{entry.description}</div> : null}
        {hasDetail ? (
          <>
            <button
              type="button"
              onClick={() => setOpen((value) => !value)}
              aria-expanded={open}
              aria-controls={detailId}
              className="inline-flex w-fit items-center gap-1 text-xs font-medium text-muted transition-colors hover:text-foreground"
            >
              <ChevronDown aria-hidden="true" className={cn('size-3.5 transition-transform', open && 'rotate-180')} />
              {open ? 'Hide technical detail' : 'Show technical detail'}
            </button>
            {open ? (
              <div id={detailId} className="mt-1 rounded-md border border-border bg-surface-muted px-3 py-2">
                {entry.detail}
              </div>
            ) : null}
          </>
        ) : null}
      </div>
    </li>
  );
}

/** Raw JSON block used for step payloads and audit metadata. */
export function PayloadBlock({ value }: { value: unknown }) {
  const text = safeStringify(value);
  return (
    <pre className="max-h-64 overflow-auto font-mono text-[11px] leading-relaxed whitespace-pre-wrap break-words text-secondary">{text}</pre>
  );
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2) ?? String(value);
  } catch {
    return '[unserialisable payload]';
  }
}

export function stepMeta(step: { latencyMs: number | null; status: string }): string | undefined {
  const duration = formatDurationMs(step.latencyMs);
  return duration === '—' ? undefined : duration;
}
