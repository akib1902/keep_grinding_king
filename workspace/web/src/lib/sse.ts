/**
 * Server-Sent Events wire-format parsing (FDD §10.3).
 *
 * Kept as pure functions so the framing rules — multi-line `data`, comment
 * heartbeats, `id` tracking, CRLF — are unit-testable without a network.
 *
 * The backend emits `id`, `event`, `data` and `: heartbeat` comment frames
 * (`src/infra/http/sse.ts`).
 */

export interface SseFrame {
  /** The `id:` field, or null when the frame carried none. */
  id: string | null;
  /** The `event:` field; defaults to "message" when absent. */
  event: string;
  /** Concatenated `data:` lines. */
  data: string;
  /** The `retry:` field in milliseconds, when present and numeric. */
  retry?: number;
  /** True for comment-only frames (heartbeats). */
  comment?: boolean;
}

interface ParserState {
  buffer: string;
  dataLines: string[];
  eventType: string | null;
  lastId: string | null;
  retry: number | null;
  hasComment: boolean;
}

export interface SseParser {
  /** Feeds a chunk and returns every complete frame it produced. */
  push(chunk: string): SseFrame[];
  /** Flushes any trailing frame at end-of-stream. */
  flush(): SseFrame[];
}

export function createSseParser(): SseParser {
  const state: ParserState = { buffer: '', dataLines: [], eventType: null, lastId: null, retry: null, hasComment: false };

  const reset = (): void => {
    state.dataLines = [];
    state.eventType = null;
    state.retry = null;
    state.hasComment = false;
  };

  const dispatch = (): SseFrame | null => {
    const hasData = state.dataLines.length > 0;
    const comment = state.hasComment && !hasData;
    if (!hasData && !comment) {
      reset();
      return null;
    }
    const frame: SseFrame = {
      id: state.lastId,
      event: state.eventType ?? 'message',
      data: state.dataLines.join('\n'),
    };
    if (comment) frame.comment = true;
    if (state.retry !== null && Number.isFinite(state.retry)) frame.retry = state.retry;
    reset();
    return frame;
  };

  const handleLine = (rawLine: string): SseFrame | null => {
    // A blank line dispatches the accumulated frame.
    if (rawLine === '') return dispatch();
    if (rawLine.startsWith(':')) {
      state.hasComment = true;
      return null;
    }
    const colon = rawLine.indexOf(':');
    const field = colon === -1 ? rawLine : rawLine.slice(0, colon);
    let value = colon === -1 ? '' : rawLine.slice(colon + 1);
    // A single leading space after the colon is part of the framing, not the value.
    if (value.startsWith(' ')) value = value.slice(1);

    switch (field) {
      case 'data':
        state.dataLines.push(value);
        break;
      case 'event':
        state.eventType = value;
        break;
      case 'id':
        // Per the spec, an `id` containing NUL is ignored.
        if (!value.includes('\u0000')) state.lastId = value;
        break;
      case 'retry': {
        const parsed = Number.parseInt(value, 10);
        if (Number.isFinite(parsed) && parsed >= 0) state.retry = parsed;
        break;
      }
      default:
        // Unknown fields are ignored, as the spec requires.
        break;
    }
    return null;
  };

  return {
    push(chunk: string): SseFrame[] {
      state.buffer += chunk;
      const frames: SseFrame[] = [];
      let newlineIndex = state.buffer.indexOf('\n');
      while (newlineIndex !== -1) {
        let line = state.buffer.slice(0, newlineIndex);
        state.buffer = state.buffer.slice(newlineIndex + 1);
        if (line.endsWith('\r')) line = line.slice(0, -1);
        const frame = handleLine(line);
        if (frame) frames.push(frame);
        newlineIndex = state.buffer.indexOf('\n');
      }
      return frames;
    },
    flush(): SseFrame[] {
      const frames: SseFrame[] = [];
      if (state.buffer.length > 0) {
        const frame = handleLine(state.buffer.endsWith('\r') ? state.buffer.slice(0, -1) : state.buffer);
        state.buffer = '';
        if (frame) frames.push(frame);
      }
      const trailing = dispatch();
      if (trailing) frames.push(trailing);
      return frames;
    },
  };
}

/** Parses a complete SSE transcript; used by tests and diagnostics. */
export function parseSseTranscript(text: string): SseFrame[] {
  const parser = createSseParser();
  return [...parser.push(text), ...parser.flush()];
}

export interface RunEventPayload {
  id: string;
  runId: string;
  sequence: number;
  eventType: string;
  version: number;
  payload: Record<string, unknown>;
  createdAt: string;
}

/** Parses a frame's JSON payload, returning null instead of throwing. */
export function parseEventData<T = RunEventPayload>(frame: SseFrame): T | null {
  if (!frame.data) return null;
  try {
    return JSON.parse(frame.data) as T;
  } catch {
    return null;
  }
}
