'use client';

import { Radio, WifiOff } from 'lucide-react';
import { Alert } from '@/components/ui/alert';
import { cn } from '@/lib/cn';
import { describeApiError } from '@/lib/errors';
import type { StreamState } from '@/lib/event-stream';

const LABELS: Record<StreamState['status'], string> = {
  idle: 'Stream idle',
  connecting: 'Connecting to the event stream…',
  open: 'Live · following the durable event stream',
  reconnecting: 'Reconnecting to the event stream…',
  closed: 'Stream closed by the server',
  error: 'Event stream unavailable',
};

const TONE_CLASS: Record<StreamState['status'], string> = {
  idle: 'bg-muted',
  connecting: 'animate-lf-pulse bg-info',
  open: 'animate-lf-pulse bg-success',
  reconnecting: 'animate-lf-pulse bg-warning',
  closed: 'bg-muted',
  error: 'bg-danger',
};

/**
 * Event-stream status (FDD §13).
 *
 * The critical product rule lives here: a connection problem must never be
 * presented as a run problem. The banner says exactly what is wrong and what the
 * console is doing about it, and the page keeps rendering the last known
 * authoritative data.
 */
export function LiveStatusBar({
  state,
  liveEventCount,
  className,
}: {
  state: StreamState;
  liveEventCount: number;
  className?: string;
}) {
  const degraded = state.status === 'reconnecting' || state.status === 'error';
  return (
    <div className={cn('flex flex-col gap-3', className)}>
      <div aria-live="polite" className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
        <span className="inline-flex items-center gap-2">
          <span aria-hidden="true" className={cn('size-2 rounded-full', TONE_CLASS[state.status])} />
          {LABELS[state.status]}
        </span>
        <span>
          Live frames received: <span className="tnum">{liveEventCount}</span>
        </span>
        {state.lastEventId ? (
          <span className="font-mono">
            last event {state.lastEventId.slice(0, 8)}
            {state.closedWith ? ` · closed as ${state.closedWith}` : ''}
          </span>
        ) : null}
        {state.connectionCount > 1 ? <span>reconnected ×{state.connectionCount - 1}</span> : null}
      </div>

      {degraded ? (
        <Alert tone="warning" role="status" title="The event stream is interrupted — this is not a run failure">
          <p className="flex items-start gap-2">
            <WifiOff aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
            <span>
              {state.error
                ? `${describeApiError(state.error)} `
                : 'The connection dropped. '}
              The console keeps the last authoritative state visible, reconnects with the last received event id, and re-reads run state after
              reconnecting. Run status shown below comes from the API, not from the missing connection.
            </span>
          </p>
        </Alert>
      ) : null}

      {state.status === 'open' ? (
        <p className="flex items-center gap-2 text-xs text-muted">
          <Radio aria-hidden="true" className="size-3.5" />
          Durable events are replayed from the backend, so a dropped connection cannot hide a state change.
        </p>
      ) : null}
    </div>
  );
}
