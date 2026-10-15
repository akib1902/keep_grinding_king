import { describe, expect, it } from 'vitest';
import {
  ApiError,
  describeApiError,
  isAuthorizationFailure,
  isRetryableStatus,
  isSessionInvalid,
  normalizeApiError,
  normalizeNetworkError,
} from '@/lib/errors';
import { buildUrl } from '@/lib/api-client';

describe('normalizeApiError', () => {
  it('reads the backend error envelope', () => {
    const error = normalizeApiError(403, {
      error: { code: 'FORBIDDEN', message: 'The ANALYST role does not hold the approvals:decide permission.', requestId: 'req-1' },
    });
    expect(error).toBeInstanceOf(ApiError);
    expect(error.code).toBe('FORBIDDEN');
    expect(error.status).toBe(403);
    expect(error.requestId).toBe('req-1');
    expect(error.message).toContain('approvals:decide');
    expect(error.retryable).toBe(false);
  });

  it('keeps structured details when the backend supplies them', () => {
    const error = normalizeApiError(409, {
      error: { code: 'INVALID_STATE_TRANSITION', message: 'Run status cannot change.', details: { from: 'COMPLETED', to: 'RUNNING' } },
    });
    expect(error.details).toEqual({ from: 'COMPLETED', to: 'RUNNING' });
  });

  it('falls back to a documented code and message when the body is unusable', () => {
    expect(normalizeApiError(401, null).code).toBe('AUTHENTICATION_REQUIRED');
    expect(normalizeApiError(404, undefined).code).toBe('NOT_FOUND');
    expect(normalizeApiError(422, 'not json').code).toBe('UNPROCESSABLE');
    expect(normalizeApiError(500, {}).code).toBe('INTERNAL_ERROR');
    expect(normalizeApiError(418, {}).code).toBe('REQUEST_FAILED');
    expect(normalizeApiError(503, {}).message).toMatch(/server failed/i);
  });

  it('classifies retryability from the status code', () => {
    expect(isRetryableStatus(503)).toBe(true);
    expect(isRetryableStatus(429)).toBe(true);
    expect(isRetryableStatus(408)).toBe(true);
    expect(isRetryableStatus(400)).toBe(false);
    expect(isRetryableStatus(401)).toBe(false);
    expect(isRetryableStatus(404)).toBe(false);
  });
});

describe('normalizeNetworkError', () => {
  it('passes an ApiError through unchanged', () => {
    const original = new ApiError({ code: 'X', message: 'y', status: 400 });
    expect(normalizeNetworkError(original)).toBe(original);
  });

  it('treats a transport failure as retryable', () => {
    const error = normalizeNetworkError(new TypeError('Failed to fetch'));
    expect(error.code).toBe('NETWORK_ERROR');
    expect(error.status).toBe(0);
    expect(error.retryable).toBe(true);
  });

  it('does not retry a deliberate cancellation', () => {
    const error = normalizeNetworkError(new DOMException('aborted', 'AbortError'));
    expect(error.code).toBe('REQUEST_ABORTED');
    expect(error.retryable).toBe(false);
  });
});

describe('session and authorization classification', () => {
  it('identifies a dead session from status or code', () => {
    expect(isSessionInvalid(new ApiError({ code: 'SOMETHING', message: '', status: 401 }))).toBe(true);
    expect(isSessionInvalid(new ApiError({ code: 'TOKEN_INVALID', message: '', status: 400 }))).toBe(true);
    expect(isSessionInvalid(new ApiError({ code: 'FORBIDDEN', message: '', status: 403 }))).toBe(false);
    expect(isSessionInvalid(new Error('boom'))).toBe(false);
  });

  it('identifies an authorization refusal', () => {
    expect(isAuthorizationFailure(new ApiError({ code: 'FORBIDDEN', message: '', status: 403 }))).toBe(true);
    expect(isAuthorizationFailure(new ApiError({ code: 'NOT_FOUND', message: '', status: 404 }))).toBe(false);
  });
});

describe('describeApiError', () => {
  it('includes a short reference when the backend supplied a request id', () => {
    const error = normalizeApiError(500, { error: { code: 'INTERNAL_ERROR', message: 'boom', requestId: 'abcdef123456' } });
    expect(describeApiError(error)).toBe('boom (ref abcdef12)');
  });

  it('handles plain errors and unknown values', () => {
    expect(describeApiError(new Error('plain'))).toBe('plain');
    expect(describeApiError('nonsense')).toMatch(/unrecognised response/i);
  });
});

describe('buildUrl', () => {
  it('joins the path and encodes query parameters', () => {
    expect(buildUrl('/api/runs', undefined, 'http://api.test')).toBe('http://api.test/api/runs');
    expect(buildUrl('api/runs/1', undefined, 'http://api.test')).toBe('http://api.test/api/runs/1');
    expect(buildUrl('/api/runs', { limit: 100 }, 'http://api.test')).toBe('http://api.test/api/runs?limit=100');
  });

  it('omits empty parameters instead of sending blanks', () => {
    expect(buildUrl('/api/runs', { limit: undefined, after: '', skip: null }, 'http://api.test')).toBe('http://api.test/api/runs');
    expect(buildUrl('/api/runs', { after: 'id 1' }, 'http://api.test')).toBe('http://api.test/api/runs?after=id+1');
  });
});
