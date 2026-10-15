'use client';

import { useSession } from '@/features/auth/session-provider';
import { useReadiness } from '@/features/system/hooks';
import { cn } from '@/lib/cn';

/**
 * Service / event-stream status (FDD §7.1, §13).
 *
 * The indicator distinguishes "API reachable", "API degraded" and "API
 * unreachable" explicitly, so a transport problem is never shown as a financial
 * problem.
 */
export function ServiceIndicator() {
  const { status: sessionStatus } = useSession();
  const { data, isError, isPending } = useReadiness(sessionStatus !== 'loading');

  const state = isPending
    ? { label: 'Checking service', tone: 'neutral' as const }
    : isError || !data
      ? { label: 'API unreachable', tone: 'danger' as const }
      : data.status === 'ready'
        ? { label: 'Service ready', tone: 'success' as const }
        : { label: 'Service degraded', tone: 'warning' as const };

  const dot = {
    neutral: 'bg-muted',
    success: 'bg-success',
    warning: 'bg-warning',
    danger: 'bg-danger',
  }[state.tone];

  const detail = data ? Object.entries(data.checks).map(([key, value]) => `${key}: ${value}`).join(' · ') : 'No response from /health/ready yet.';

  return (
    <span
      className="inline-flex items-center gap-2 rounded-md border border-border bg-surface px-2.5 py-1 text-xs text-muted"
      title={detail}
    >
      <span aria-hidden="true" className={cn('size-2 rounded-full', dot, state.tone === 'neutral' && 'animate-lf-pulse')} />
      {/* Text label is always present: the dot is decoration, not the message. */}
      <span className="hidden sm:inline">{state.label}</span>
      <span className="sr-only sm:hidden">{state.label}</span>
    </span>
  );
}
