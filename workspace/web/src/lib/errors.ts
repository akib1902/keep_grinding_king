/**
 * API error normalisation (FDD §9.2).
 *
 * Every failure the UI can encounter — transport, validation, authorization,
 * policy, conflict — becomes one `ApiError` shape with a stable `code`. Views never
 * branch on HTTP status or message text; they branch on `code` and render the
 * backend's safe message.
 */

export interface ApiErrorBody {
  error?: {
    code?: unknown;
    message?: unknown;
    requestId?: unknown;
    details?: unknown;
  };
}

export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly requestId: string | null;
  readonly details: Record<string, unknown> | null;
  /** Whether retrying the same request could plausibly succeed. */
  readonly retryable: boolean;

  constructor(options: {
    code: string;
    message: string;
    status: number;
    requestId?: string | null;
    details?: Record<string, unknown> | null;
    retryable?: boolean;
  }) {
    super(options.message);
    this.name = 'ApiError';
    this.code = options.code;
    this.status = options.status;
    this.requestId = options.requestId ?? null;
    this.details = options.details ?? null;
    this.retryable = options.retryable ?? isRetryableStatus(options.status);
  }
}

export function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

const NETWORK_MESSAGE = 'The API could not be reached. Check that the backend is running and try again.';
const UNKNOWN_MESSAGE = 'The request failed and the server returned an unrecognised response.';

/** Converts a fetch/network failure into an `ApiError`. */
export function normalizeNetworkError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;
  if (error instanceof DOMException && error.name === 'AbortError') {
    return new ApiError({ code: 'REQUEST_ABORTED', message: 'The request was cancelled.', status: 0, retryable: false });
  }
  return new ApiError({
    code: 'NETWORK_ERROR',
    message: error instanceof Error && error.message ? error.message : NETWORK_MESSAGE,
    status: 0,
    retryable: true,
  });
}

/**
 * Converts a non-2xx HTTP response into an `ApiError`, preferring the backend's
 * documented `{ error: { code, message, requestId } }` envelope.
 */
export function normalizeApiError(status: number, body: unknown): ApiError {
  const envelope = (body ?? null) as ApiErrorBody | null;
  const rawCode = envelope?.error?.code;
  const rawMessage = envelope?.error?.message;
  const rawRequestId = envelope?.error?.requestId;
  const rawDetails = envelope?.error?.details;

  const code = typeof rawCode === 'string' && rawCode.length > 0 ? rawCode : statusToFallbackCode(status);
  const message = typeof rawMessage === 'string' && rawMessage.length > 0 ? rawMessage : fallbackMessage(status);
  const requestId = typeof rawRequestId === 'string' ? rawRequestId : null;
  const details =
    rawDetails && typeof rawDetails === 'object' && !Array.isArray(rawDetails)
      ? (rawDetails as Record<string, unknown>)
      : null;

  return new ApiError({ code, message, status, requestId, details });
}

function statusToFallbackCode(status: number): string {
  if (status === 401) return 'AUTHENTICATION_REQUIRED';
  if (status === 403) return 'FORBIDDEN';
  if (status === 404) return 'NOT_FOUND';
  if (status === 409) return 'CONFLICT';
  if (status === 422) return 'UNPROCESSABLE';
  if (status >= 500) return 'INTERNAL_ERROR';
  return 'REQUEST_FAILED';
}

function fallbackMessage(status: number): string {
  if (status === 401) return 'Your session has expired. Sign in again to continue.';
  if (status === 403) return 'Your role is not permitted to perform this action.';
  if (status === 404) return 'The requested resource does not exist or is not visible to your account.';
  if (status === 409) return 'The resource changed while this request was in flight. Reload and try again.';
  if (status === 422) return 'The backend rejected this request under its financial policy.';
  if (status >= 500) return 'The server failed to complete the request.';
  return UNKNOWN_MESSAGE;
}

/** Human-readable summary for toasts and error panels. */
export function describeApiError(error: unknown): string {
  if (error instanceof ApiError) {
    return error.requestId ? `${error.message} (ref ${error.requestId.slice(0, 8)})` : error.message;
  }
  if (error instanceof Error) return error.message;
  return UNKNOWN_MESSAGE;
}

/** Error codes that mean "this session is no longer usable". */
export const SESSION_INVALID_CODES = new Set([
  'AUTHENTICATION_REQUIRED',
  'TOKEN_INVALID',
  'NETWORK_SESSION_EXPIRED',
]);

export function isSessionInvalid(error: unknown): boolean {
  return error instanceof ApiError && (error.status === 401 || SESSION_INVALID_CODES.has(error.code));
}

/** Error codes that mean "hidden or not, the backend refused the action". */
export function isAuthorizationFailure(error: unknown): boolean {
  return error instanceof ApiError && error.status === 403;
}
