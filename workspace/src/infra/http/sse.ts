/**
 * Server-Sent Events — PR-10, SRS-EVENT-001..007.
 *
 * The stream is a *reader over durable state*, never a channel that could lose an
 * event. Events are persisted first; this handler replays everything after the
 * client's last seen id and then tails the table. A client that reconnects with
 * `Last-Event-ID` therefore cannot miss an event, which is what makes a dropped
 * connection a non-event rather than a correctness problem.
 *
 * Deliberate trade-off: tailing is a short-interval database poll rather than a
 * Redis pub/sub fan-out. It costs a handful of indexed queries per second and buys
 * replay correctness, no cross-process coordination, and no second source of
 * truth. Under heavy fan-out, pub/sub would be layered on as a wake-up signal
 * while the database stays authoritative.
 */
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { LoggerPort, RunEventRecord, Store } from '../../app/ports.js';
import { isTerminalRunStatus } from '../../domain/state.js';

export interface SseDeps {
  store: Store;
  logger: LoggerPort;
  pollIntervalMs: number;
  heartbeatMs: number;
}

export interface SseHandle {
  close(): void;
}

export async function streamRunEvents(
  deps: SseDeps,
  request: FastifyRequest,
  reply: FastifyReply,
  runId: string,
): Promise<SseHandle> {
  const lastEventId = resolveLastEventId(request);
  const raw = reply.raw;

  // Taking over the socket with `writeHead` replaces every header Fastify had
  // already set, including the CORS headers applied by the onRequest hook and the
  // correlation id. Capture them first and carry them across, otherwise a browser
  // on a different origin is blocked from reading the stream at all. Unset
  // headers are dropped rather than forwarded as `undefined`.
  const inheritedHeaders: Record<string, string | number | string[]> = {};
  for (const [name, value] of Object.entries(reply.getHeaders())) {
    if (value !== undefined) inheritedHeaders[name] = value;
  }

  reply.hijack();
  raw.writeHead(200, {
    ...inheritedHeaders,
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
  });
  raw.write(': stream open\n\n');

  let cursor = await resolveCursor(deps.store, runId, lastEventId);
  let closed = false;
  let idleTicks = 0;
  // Declared before `close` can run so a client disconnect during setup cannot
  // hit a temporal-dead-zone reference.
  let poll: NodeJS.Timeout | null = null;
  let heartbeat: NodeJS.Timeout | null = null;

  const send = (event: RunEventRecord): void => {
    // `id` is the durable event id; `data` carries the sequence so a client can
    // replay with either the id or the numeric sequence.
    raw.write(`id: ${event.id}\nevent: ${event.eventType}\n`);
    raw.write(`data: ${JSON.stringify({ ...event, createdAt: event.createdAt.toISOString() })}\n\n`);
  };

  const tick = async (): Promise<void> => {
    if (closed) return;
    try {
      const events = await deps.store.events.listByRun(runId, cursor, 200);
      for (const event of events) {
        send(event);
        cursor = event.sequence;
        idleTicks = 0;
      }

      if (events.length === 0) {
        idleTicks += 1;
        const run = await deps.store.runs.findById(runId);
        // Clean termination: once the run is terminal and everything is flushed,
        // close the stream instead of holding the connection open forever.
        if (run && isTerminalRunStatus(run.status)) {
          raw.write(`event: stream.closed\ndata: ${JSON.stringify({ runId, status: run.status })}\n\n`);
          close();
          return;
        }
      }
    } catch (error) {
      deps.logger.error(
        { runId, error: error instanceof Error ? error.message : 'unknown' },
        'event stream polling failed',
      );
      idleTicks += 1;
      if (idleTicks > 20) {
        close();
        return;
      }
    }
  };

  const heartbeatTick = (): void => {
    if (closed) return;
    // A comment frame keeps proxies from tearing down an idle connection and lets
    // the client detect a dead one (SRS-EVENT-007).
    raw.write(`: heartbeat ${new Date().toISOString()}\n\n`);
  };

  const close = (): void => {
    if (closed) return;
    closed = true;
    if (poll) clearInterval(poll);
    if (heartbeat) clearInterval(heartbeat);
    raw.end();
  };

  poll = setInterval(() => void tick(), deps.pollIntervalMs);
  heartbeat = setInterval(heartbeatTick, deps.heartbeatMs);
  request.raw.on('close', close);
  request.raw.on('error', close);

  await tick();

  return { close };
}

function resolveLastEventId(request: FastifyRequest): string | null {
  const header = request.headers['last-event-id'];
  if (typeof header === 'string' && header.length > 0) return header;
  const query = request.query as { lastEventId?: string; afterEventId?: string } | undefined;
  return query?.lastEventId ?? query?.afterEventId ?? null;
}

/**
 * Accepts either a durable event UUID or a numeric sequence; both are documented
 * because both are returned by the API.
 */
async function resolveCursor(store: Store, runId: string, lastEventId: string | null): Promise<number> {
  if (!lastEventId) return 0;
  if (/^\d+$/.test(lastEventId)) return Number(lastEventId);
  const events = await store.events.listByRun(runId, 0, 1000);
  const match = events.find((event) => event.id === lastEventId);
  return match ? match.sequence : 0;
}
