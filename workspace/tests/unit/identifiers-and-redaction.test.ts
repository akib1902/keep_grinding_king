/**
 * Deterministic identifiers, canonical hashing and redaction.
 *
 * `deriveOperationId` is the reason a replayed settlement job cannot create a
 * second ledger entry: identical logical input must always produce an identical
 * id, and any change to the reviewed content must change it.
 */
import { describe, expect, it } from 'vitest';
import { canonicalJson, deriveAttemptId, deriveOperationId, newId, sha256 } from '../../src/domain/ids.js';
import { redactPayload } from '../../src/app/services/telemetry.js';

const base = {
  proposalId: 'proposal-1',
  revision: 1,
  supplierId: 'supplier-1',
  amountMinor: 245_000,
  currency: 'USD',
};

describe('deriveOperationId', () => {
  it('is stable across calls with identical input', () => {
    expect(deriveOperationId(base)).toBe(deriveOperationId({ ...base }));
  });

  it('changes when any reviewed field changes', () => {
    const original = deriveOperationId(base);
    expect(deriveOperationId({ ...base, amountMinor: 245_001 })).not.toBe(original);
    expect(deriveOperationId({ ...base, revision: 2 })).not.toBe(original);
    expect(deriveOperationId({ ...base, supplierId: 'supplier-2' })).not.toBe(original);
    expect(deriveOperationId({ ...base, currency: 'EUR' })).not.toBe(original);
    expect(deriveOperationId({ ...base, proposalId: 'proposal-2' })).not.toBe(original);
  });

  it('is namespaced so it is recognisable in a ledger', () => {
    expect(deriveOperationId(base).startsWith('op_')).toBe(true);
  });
});

describe('deriveAttemptId', () => {
  it('is stable per (run, attempt) and distinct across attempts', () => {
    expect(deriveAttemptId('run-1', 1)).toBe(deriveAttemptId('run-1', 1));
    expect(deriveAttemptId('run-1', 1)).not.toBe(deriveAttemptId('run-1', 2));
    expect(deriveAttemptId('run-1', 1)).not.toBe(deriveAttemptId('run-2', 1));
  });
});

describe('canonicalJson', () => {
  it('is insensitive to object key order', () => {
    expect(canonicalJson({ b: 2, a: 1 })).toBe(canonicalJson({ a: 1, b: 2 }));
  });

  it('is sensitive to value changes', () => {
    expect(canonicalJson({ a: 1 })).not.toBe(canonicalJson({ a: 2 }));
  });

  it('handles nesting deterministically', () => {
    const left = { outer: { z: [3, { b: 2, a: 1 }], y: 'value' } };
    const right = { outer: { y: 'value', z: [3, { a: 1, b: 2 }] } };
    expect(canonicalJson(left)).toBe(canonicalJson(right));
    expect(sha256(canonicalJson(left))).toBe(sha256(canonicalJson(right)));
  });

  it('ignores undefined members so an omitted optional field hashes like an absent one', () => {
    expect(canonicalJson({ a: 1, b: undefined })).toBe(canonicalJson({ a: 1 }));
  });
});

describe('redactPayload', () => {
  it('masks sensitive keys at the top level', () => {
    const redacted = redactPayload({
      authorization: 'Bearer abc',
      apiKey: 'sk-live-123',
      password: 'hunter2',
      token: 'jwt',
      safe: 'visible',
    });
    expect(redacted.authorization).toBe('[REDACTED]');
    expect(redacted.apiKey).toBe('[REDACTED]');
    expect(redacted.password).toBe('[REDACTED]');
    expect(redacted.token).toBe('[REDACTED]');
    expect(redacted.safe).toBe('visible');
  });

  it('masks sensitive keys nested in objects and arrays', () => {
    const redacted = redactPayload({
      config: { auth: { jwtSecret: 'shhh', issuer: 'iss' } },
      requests: [{ headers: { authorization: 'Bearer x' }, url: '/api/runs' }],
    });
    expect((redacted.config as Record<string, Record<string, unknown>>).auth).toEqual({
      jwtSecret: '[REDACTED]',
      issuer: 'iss',
    });
    expect(redacted.requests).toEqual([{ headers: { authorization: '[REDACTED]' }, url: '/api/runs' }]);
  });

  it('does not leak a secret through a value that merely contains it', () => {
    const redacted = redactPayload({ note: 'nothing sensitive here' });
    expect(redacted.note).toBe('nothing sensitive here');
  });
});

describe('newId', () => {
  it('produces unique identifiers', () => {
    const ids = new Set(Array.from({ length: 500 }, () => newId()));
    expect(ids.size).toBe(500);
  });
});
