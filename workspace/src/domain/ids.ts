/**
 * Deterministic identifiers.
 *
 * Queue messages carry stable identifiers only (SRS-QUEUE-006) and the durable
 * record — not the queue — is authoritative. Deriving identifiers from content
 * hashes is what makes repeated delivery safe: the same logical operation always
 * produces the same id, so a database uniqueness constraint can reject the
 * duplicate instead of creating a second financial effect (SRS-SETTLE-002/005).
 */
import { createHash, randomUUID } from 'node:crypto';

export function newId(): string {
  return randomUUID();
}

/** Deterministic attempt identifier: one per (run, attempt number). */
export function deriveAttemptId(runId: string, attemptCount: number): string {
  return sha256(`attempt:${runId}:${attemptCount}`).slice(0, 32);
}

/**
 * Stable settlement operation id.
 *
 * Derived from the immutable reviewed proposal content, so a replayed settlement
 * job for the same reviewed proposal can never mint a new operation id.
 */
export function deriveOperationId(input: {
  proposalId: string;
  revision: number;
  supplierId: string;
  amountMinor: number;
  currency: string;
}): string {
  const canonical = [
    'settlement',
    input.proposalId,
    `rev:${input.revision}`,
    input.supplierId,
    `amount:${input.amountMinor}`,
    `ccy:${input.currency}`,
  ].join('|');
  return `op_${sha256(canonical).slice(0, 40)}`;
}

export function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

/**
 * Canonical JSON: object keys sorted recursively so that logically identical
 * payloads always hash identically (used by request idempotency and by the
 * proposal review hash).
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return Object.fromEntries(entries.map(([k, v]) => [k, sortValue(v)]));
  }
  return value;
}
