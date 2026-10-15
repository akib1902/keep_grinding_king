/**
 * The live event stream client (FDD §10.3).
 *
 * `EventSource` cannot send an `Authorization` header, and this API requires one,
 * so the stream is read through `fetch` and parsed by the pure SSE parser in
 * `lib/sse.ts`. That also gives explicit control over three behaviours the FDD
 * requires:
 *
 *  - reconnect with the last received event id, so no durable event is lost,
 *  - de-duplication by event id, so a reconnect cannot duplicate timeline rows,
 *  - a status the UI can render, so a dropped connection is never mistaken for a
 *    failed run.
 */
import { API_BASE_URL } from './config';
import { ApiError, normalizeApiError } from './errors';
import { createSseParser, parseEventData, type RunEventPayload, type SseFrame } from './sse';

export type StreamStatus = 'idle' | 'connecting' | 'open' | 'reconnecting' | 'closed' | 'error';

export interface StreamState {
  status: StreamStatus;
  /** Increments on every successful (re)connection, for "refetch after reconnect". */
  connectionCount: number;
  /** Last durable event id received, sent back as `Last-Event-ID` on reconnect. */
  lastEventId: string | null;
  /** Reason the stream ended, when it ended abnormally. */
  error: ApiError | null;
  /** Terminal status reported by the server's `stream.closed` frame. */
  closedWith: string | null;
}

export interface RunStreamOptions {
  runId: string;
  token: string;
  baseUrl?: string;
  /** Called for every accepted (non-duplicate) durable event. */
  onEvent: (event: RunEventPayload) => void;
  /** Called whenever the connection state changes. */
  onState: (state: StreamState) => void;
  /** Called when the server closes the stream after a terminal run status. */
  onClosed?: (detail: { runId: string; status: string }) => void;
}

export interface RunStreamHandle {
  close(): void;
  /** The state as of the last callback. */
  state(): StreamState;
}

const INITIAL_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 15_000;

/**
 * Bounds the memory used for de-duplication while still covering far more events
 * than a single run produces (a run emits tens of events).
 */
export function createEventDeduper(limit = 500): { accept(id: string | null): boolean; size(): number } {
  const seen = new Set<string>();
  const order: string[] = [];
  return {
    accept(id: string | null): boolean {
      if (!id) return true;
      if (seen.has(id)) return false;
      seen.add(id);
      order.push(id);
      if (order.length > limit) {
        const oldest = order.shift();
        if (oldest) seen.delete(oldest);
      }
      return true;
    },
    size: () => seen.size,
  };
}

export function openRunEventStream(options: RunStreamOptions): RunStreamHandle {
  const baseUrl = (options.baseUrl ?? API_BASE_URL).replace(/\/+$/, '');
  const deduper = createEventDeduper();
  let state: StreamState = {
    status: 'idle',
    connectionCount: 0,
    lastEventId: null,
    error: null,
    closedWith: null,
  };
  let closed = false;
  let controller: AbortController | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let attempt = 0;

  const update = (patch: Partial<StreamState>): void => {
    state = { ...state, ...patch };
    options.onState(state);
  };

  const scheduleReconnect = (): void => {
    if (closed) return;
    const delay = Math.min(MAX_BACKOFF_MS, INITIAL_BACKOFF_MS * 2 ** attempt);
    const jitter = Math.floor(Math.random() * 250);
    attempt += 1;
    update({ status: 'reconnecting' });
    retryTimer = setTimeout(() => {
      retryTimer = null;
      void connect();
    }, delay + jitter);
  };

  const handleFrame = (frame: SseFrame): void => {
    if (frame.comment) return;
    if (frame.event === 'stream.closed') {
      const detail = parseEventData<{ runId: string; status: string }>(frame);
      const status = detail?.status ?? 'unknown';
      closed = true;
      update({ status: 'closed', closedWith: status });
      options.onClosed?.({ runId: options.runId, status });
      controller?.abort();
      return;
    }
    const event = parseEventData<RunEventPayload>(frame);
    if (!event) return;
    if (!deduper.accept(event.id ?? frame.id)) return;
    if (frame.id) state.lastEventId = frame.id;
    else if (event.id) state.lastEventId = event.id;
    options.onEvent(event);
  };

  const connect = async (): Promise<void> => {
    if (closed) return;
    update({ status: state.connectionCount === 0 ? 'connecting' : 'reconnecting', error: null });
    controller = new AbortController();
    const headers: Record<string, string> = {
      accept: 'text/event-stream',
      authorization: `Bearer ${options.token}`,
    };
    if (state.lastEventId) headers['last-event-id'] = state.lastEventId;

    let response: Response;
    try {
      response = await fetch(`${baseUrl}/api/tasks/${options.runId}/stream`, {
        method: 'GET',
        headers,
        signal: controller.signal,
        cache: 'no-store',
        credentials: 'omit',
      });
    } catch {
      if (closed) return;
      scheduleReconnect();
      return;
    }

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      let body: unknown = null;
      try {
        body = text ? (JSON.parse(text) as unknown) : null;
      } catch {
        body = null;
      }
      const error = normalizeApiError(response.status, body);
      // A 401/403 will not become a success by retrying; surface it and stop.
      if (response.status === 401 || response.status === 403 || response.status === 404) {
        closed = true;
        update({ status: 'error', error });
        return;
      }
      update({ error, status: 'reconnecting' });
      scheduleReconnect();
      return;
    }

    if (!response.body) {
      closed = true;
      update({ status: 'error', error: new ApiError({ code: 'STREAM_UNREADABLE', message: 'The event stream had no body.', status: 0 }) });
      return;
    }

    attempt = 0;
    update({ status: 'open', connectionCount: state.connectionCount + 1, error: null });

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    const parser = createSseParser();
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        for (const frame of parser.push(decoder.decode(value, { stream: true }))) handleFrame(frame);
      }
      for (const frame of parser.flush()) handleFrame(frame);
    } catch {
      // A mid-stream transport error is a reconnect, never a run failure.
      if (!closed) scheduleReconnect();
      return;
    }

    if (!closed) scheduleReconnect();
  };

  void connect();

  return {
    close(): void {
      closed = true;
      if (retryTimer) clearTimeout(retryTimer);
      retryTimer = null;
      controller?.abort();
      update({ status: 'idle' });
    },
    state: () => state,
  };
}
