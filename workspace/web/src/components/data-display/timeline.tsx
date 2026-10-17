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
  /** Secondary metadata, e.g. a tool name or duration. */
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
      {entries.map((entry) => (
        <TimelineRow key={entry.id} entry={entry} />
      ))}
    </ol>
  );
}

function TimelineRow({ entry }: { entry: TimelineEntry }) {
  const [open, setOpen] = useState(false);
  const detailId = useId();
  const meta = stepStatusMeta(entry.status);
  const tone = entry.tone === 'muted' ? 'neutral' : meta.tone === 'warning' ? 'danger' : meta.tone;
  const Icon = ICONS[tone];
  const hasDetail = entry.detail !== undefined && entry.detail !== null;

  return (
    <li className="flex gap-3 py-2.5 first:pt-0 last:pb-0">
      <Icon aria-hidden="true" className={cn('mt-0.5 size-[18px] shrink-0', ICON_CLASS[tone])} />
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <p className="text-[15px] leading-6 font-semibold text-foreground">{entry.title}</p>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-muted">
            {/* The label is always rendered, so the state is not colour-only. */}
            <span>{meta.label}</span>
            {entry.meta ? (
              <>
                <span aria-hidden="true">·</span>
                <span className="tnum">{entry.meta}</span>
              </>
            ) : null}
            {entry.timestamp ? (
              <>
                <span aria-hidden="true">·</span>
                <time dateTime={entry.timestamp}>{formatDateTime(entry.timestamp)}</time>
              </>
            ) : null}
          </div>
          {entry.description ? <div className="mt-1 text-[13px] text-secondary">{entry.description}</div> : null}
          {open && hasDetail ? (
            <div id={detailId} className="mt-2 rounded-lg border border-border bg-surface-muted px-3 py-2">
              {entry.detail}
            </div>
          ) : null}
        </div>
        {hasDetail ? (
          <button
            type="button"
            onClick={() => setOpen((value) => !value)}
            aria-expanded={open}
            aria-controls={detailId}
            className="grid size-7 shrink-0 place-items-center rounded-full border border-border bg-surface text-muted transition-colors hover:border-border-strong hover:text-foreground"
          >
            <ChevronDown aria-hidden="true" className={cn('size-4 transition-transform', open && 'rotate-180')} />
            <span className="sr-only">{open ? 'Hide technical detail' : 'Show technical detail'}</span>
          </button>
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
