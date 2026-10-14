/**
 * Step, event and audit recording helpers.
 *
 * Every one of these writes happens *inside* the caller's database transaction,
 * so a decision and its audit record either both exist or neither does. Events
 * are persisted before they can be streamed (SRS-EVENT-002).
 */
import type { StepType } from '../../domain/state.js';
import type { ActorType, Store } from '../ports.js';

export interface StepInput {
  runId: string;
  attemptId?: string | null;
  stepType: StepType;
  status: 'STARTED' | 'SUCCEEDED' | 'FAILED' | 'SKIPPED';
  summary?: string | null;
  payload?: Record<string, unknown> | null;
  errorCode?: string | null;
  errorMessage?: string | null;
  retryable?: boolean | null;
  latencyMs?: number | null;
}

export async function recordStep(store: Store, input: StepInput): Promise<void> {
  await store.steps.append({
    runId: input.runId,
    attemptId: input.attemptId ?? null,
    stepType: input.stepType,
    status: input.status,
    summary: input.summary ?? null,
    payload: input.payload ?? null,
    errorCode: input.errorCode ?? null,
    errorMessage: input.errorMessage ?? null,
    retryable: input.retryable ?? null,
    latencyMs: input.latencyMs ?? null,
  });
}

export async function emitEvent(
  store: Store,
  input: { runId: string; eventType: string; payload: Record<string, unknown>; version?: number },
): Promise<void> {
  await store.events.append({
    runId: input.runId,
    eventType: input.eventType,
    payload: redactPayload(input.payload),
    ...(input.version !== undefined ? { version: input.version } : {}),
  });
}

export async function recordAudit(
  store: Store,
  input: {
    tenantId: string;
    runId?: string | null;
    actorType: ActorType;
    actorId?: string | null;
    action: string;
    targetType: string;
    targetId?: string | null;
    metadata?: Record<string, unknown> | null;
  },
): Promise<void> {
  await store.audit.append({
    tenantId: input.tenantId,
    runId: input.runId ?? null,
    actorType: input.actorType,
    actorId: input.actorId ?? null,
    action: input.action,
    targetType: input.targetType,
    targetId: input.targetId ?? null,
    metadata: input.metadata ? redactPayload(input.metadata) : null,
  });
}

/**
 * Redaction applied to every event, audit record and log payload
 * (SRS-EVENT-006, SRS-OBS-004). Defence in depth: the primary control is simply
 * never putting credentials in a payload.
 */
const SENSITIVE_KEY_PATTERN = /(password|secret|token|authorization|api[-_]?key|credential|cookie|bearer)/i;

export function redactPayload(payload: Record<string, unknown>, depth = 0): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload)) {
    if (SENSITIVE_KEY_PATTERN.test(key)) {
      out[key] = '[REDACTED]';
      continue;
    }
    if (depth < 4 && value !== null && typeof value === 'object' && !Array.isArray(value)) {
      out[key] = redactPayload(value as Record<string, unknown>, depth + 1);
      continue;
    }
    if (Array.isArray(value) && depth < 4) {
      out[key] = value.map((entry) =>
        entry !== null && typeof entry === 'object' ? redactPayload(entry as Record<string, unknown>, depth + 1) : entry,
      );
      continue;
    }
    out[key] = value;
  }
  return out;
}
