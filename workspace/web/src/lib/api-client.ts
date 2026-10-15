/**
 * The single HTTP client every view uses (FDD §9.2).
 *
 * Responsibilities, in one place:
 *  - base URL configuration,
 *  - bearer credential attachment,
 *  - idempotency keys for the one logical mutation that needs them,
 *  - request timeouts via AbortController,
 *  - error normalisation to `ApiError`,
 *  - optional schema validation of the response.
 *
 * Mutating requests are never retried automatically: only `POST /api/runs`
 * carries an idempotency key, and that retry is explicit (replaying the *same*
 * key) rather than an implicit transport retry of an unknown outcome.
 */
import { API_BASE_URL } from './config';
import { ApiError, normalizeApiError, normalizeNetworkError } from './errors';
import { clearSession, getActiveToken } from './session-store';

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface ApiRequestOptions {
  method?: HttpMethod;
  /** Serialised as JSON. Omitted for GET. */
  body?: unknown;
  /** Overrides the session token; used by the sign-in call before a session exists. */
  token?: string | null;
  /** Sends `Idempotency-Key`; the backend requires 8–200 characters. */
  idempotencyKey?: string;
  signal?: AbortSignal;
  /** Client-side timeout budget. Defaults to 15 s. */
  timeoutMs?: number;
  /** Overrides the configured base URL (tests). */
  baseUrl?: string;
  /** Current time, injectable for deterministic expiry behaviour. */
  now?: number;
}

export interface ApiResponse<T> {
  data: T;
  status: number;
  requestId: string | null;
}

/** Verifies and narrows a response body; throws a typed error when it does not fit. */
export interface ResponseValidator<T> {
  parse(input: unknown): T;
}

const DEFAULT_TIMEOUT_MS = 15_000;

export function buildUrl(
  path: string,
  query?: Record<string, string | number | boolean | undefined | null>,
  origin: string = API_BASE_URL,
): string {
  const base = `${origin}${path.startsWith('/') ? path : `/${path}`}`;
  if (!query) return base;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue;
    params.set(key, String(value));
  }
  const qs = params.toString();
  return qs ? `${base}?${qs}` : base;
}

/**
 * Performs a request and returns the parsed body. Throws `ApiError` for any
 * non-2xx response, network failure or timeout.
 */
export async function apiRequest<T>(
  path: string,
  options: ApiRequestOptions = {},
  validator?: ResponseValidator<T>,
): Promise<ApiResponse<T>> {
  const { method = 'GET', body, idempotencyKey, timeoutMs = DEFAULT_TIMEOUT_MS, baseUrl, now } = options;
  const token = options.token !== undefined ? options.token : getActiveToken(now ?? Date.now());

  const controller = new AbortController();
  const externalSignal = options.signal;
  const relayAbort = (): void => controller.abort();
  if (externalSignal) {
    if (externalSignal.aborted) controller.abort();
    else externalSignal.addEventListener('abort', relayAbort, { once: true });
  }
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  const headers: Record<string, string> = { accept: 'application/json' };
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (token) headers.authorization = `Bearer ${token}`;
  if (idempotencyKey) headers['idempotency-key'] = idempotencyKey;

  let response: Response;
  try {
    response = await fetch(buildUrl(path, undefined, baseUrl ?? API_BASE_URL), {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
      // The API uses bearer tokens, not cookies; sending credentials cross-origin
      // would only widen the CORS surface.
      credentials: 'omit',
      cache: 'no-store',
    });
  } catch (error) {
    clearTimeout(timeout);
    if (externalSignal) externalSignal.removeEventListener('abort', relayAbort);
    const normalized = normalizeNetworkError(error);
    if (normalized.status === 0 && normalized.code === 'REQUEST_ABORTED' && !externalSignal?.aborted) {
      throw new ApiError({
        code: 'REQUEST_TIMEOUT',
        message: `The API did not respond within ${Math.round(timeoutMs / 1000)}s.`,
        status: 0,
        retryable: true,
      });
    }
    throw normalized;
  }
  clearTimeout(timeout);
  if (externalSignal) externalSignal.removeEventListener('abort', relayAbort);

  const requestId = response.headers.get('x-request-id');
  const text = await response.text();
  const parsed = text.length > 0 ? safeJsonParse(text) : null;

  if (!response.ok) {
    const error = normalizeApiError(response.status, parsed);
    if (error.status === 401) clearSession();
    throw error.requestId
      ? error
      : new ApiError({
          code: error.code,
          message: error.message,
          status: error.status,
          requestId,
          details: error.details,
          retryable: error.retryable,
        });
  }

  if (validator) {
    try {
      return { data: validator.parse(parsed), status: response.status, requestId };
    } catch (error) {
      throw new ApiError({
        code: 'RESPONSE_INVALID',
        message: `The API returned a response this build cannot interpret: ${
          error instanceof Error ? error.message.split('\n')[0] : 'unknown shape'
        }`,
        status: response.status,
        requestId,
        retryable: false,
      });
    }
  }

  return { data: parsed as T, status: response.status, requestId };
}

/** Convenience wrappers that return the body directly. */
export async function apiGet<T>(
  path: string,
  options: Omit<ApiRequestOptions, 'method' | 'body'> = {},
  validator?: ResponseValidator<T>,
): Promise<T> {
  const { data } = await apiRequest<T>(path, { ...options, method: 'GET' }, validator);
  return data;
}

export async function apiPost<T>(
  path: string,
  body?: unknown,
  options: Omit<ApiRequestOptions, 'method' | 'body'> = {},
  validator?: ResponseValidator<T>,
): Promise<T> {
  const { data } = await apiRequest<T>(path, { ...options, method: 'POST', body }, validator);
  return data;
}

function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}
