'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { REFETCH_MIN_INTERVAL_MS } from '@/lib/config';
import { openRunEventStream, type StreamState } from '@/lib/event-stream';
import { queryKeys } from '@/lib/query-client';
import type { RunEventPayload } from '@/lib/sse';

const INITIAL_STATE: StreamState = {
  status: 'idle',
  connectionCount: 0,
  lastEventId: null,
  error: null,
  closedWith: null,
};

export interface LiveEventsResult {
  state: StreamState;
  /** Events received live, in arrival order. */
  liveEvents: RunEventPayload[];
  /** Seconds until the next automatic retry, when reconnecting. */
  reconnecting: boolean;
}

/**
 * Subscribes to a run's durable event stream while the view needs it (FDD §10.3).
 *
 * The stream is treated as a *hint* that authoritative state changed: every batch
 * of events also invalidates the run queries (throttled), and a reconnect
 * invalidates them immediately. A dropped connection therefore degrades to
 * polling, never to a wrong screen.
 */
export function useRunEventStream(options: {
  runId: string | null;
  token: string | null;
  /** Only connect while the run is live and the tab is visible. */
  enabled: boolean;
}): LiveEventsResult {
  const { runId, token, enabled } = options;
  const queryClient = useQueryClient();
  const [state, setState] = useState<StreamState>(INITIAL_STATE);
  const [liveEvents, setLiveEvents] = useState<RunEventPayload[]>([]);
  const lastInvalidation = useRef(0);
  const invalidationTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const connectionCount = useRef(0);

  const invalidateRun = useCallback(
    (options: { immediate?: boolean } = {}) => {
      if (!runId) return;
      const run = () => {
        lastInvalidation.current = Date.now();
        void queryClient.invalidateQueries({ queryKey: queryKeys.run(runId) });
        void queryClient.invalidateQueries({ queryKey: queryKeys.runSteps(runId) });
        void queryClient.invalidateQueries({ queryKey: queryKeys.runEvents(runId) });
        void queryClient.invalidateQueries({ queryKey: queryKeys.runHistory(runId) });
        void queryClient.invalidateQueries({ queryKey: queryKeys.runAudit(runId) });
        void queryClient.invalidateQueries({ queryKey: ['runs'] });
      };
      if (options.immediate) {
        if (invalidationTimer.current) clearTimeout(invalidationTimer.current);
        invalidationTimer.current = null;
        run();
        return;
      }
      const elapsed = Date.now() - lastInvalidation.current;
      if (elapsed >= REFETCH_MIN_INTERVAL_MS) {
        run();
        return;
      }
      if (invalidationTimer.current) return;
      invalidationTimer.current = setTimeout(() => {
        invalidationTimer.current = null;
        run();
      }, REFETCH_MIN_INTERVAL_MS - elapsed);
    },
    [queryClient, runId],
  );

  useEffect(() => {
    if (!runId || !token || !enabled) {
      setState(INITIAL_STATE);
      return;
    }
    setLiveEvents([]);
    connectionCount.current = 0;

    const handle = openRunEventStream({
      runId,
      token,
      onEvent: (event) => {
        setLiveEvents((current) => (current.some((item) => item.id === event.id) ? current : [...current, event]));
        invalidateRun();
      },
      onState: (next) => {
        setState(next);
        // A reconnect means events may have been missed; refetch authoritative
        // state rather than trusting the gap.
        if (next.connectionCount > connectionCount.current) {
          if (connectionCount.current > 0) invalidateRun({ immediate: true });
          connectionCount.current = next.connectionCount;
        }
      },
      onClosed: () => invalidateRun({ immediate: true }),
    });

    return () => {
      handle.close();
      if (invalidationTimer.current) {
        clearTimeout(invalidationTimer.current);
        invalidationTimer.current = null;
      }
    };
  }, [runId, token, enabled, invalidateRun]);

  return {
    state,
    liveEvents,
    reconnecting: state.status === 'reconnecting' || state.status === 'connecting',
  };
}
