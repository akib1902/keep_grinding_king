/**
 * Typed errors. Every failure carries a stable code suitable for logs, tests and
 * client handling (SRS §8), plus an HTTP status and a retry classification used by
 * the runtime and workflow policy — never by the model.
 */

export type ErrorCategory =
  | 'VALIDATION'
  | 'AUTHORIZATION'
  | 'POLICY'
  | 'CONFLICT'
  | 'TRANSIENT'
  | 'PROVIDER'
  | 'TIMEOUT'
  | 'BUDGET'
  | 'INTERNAL';

export interface AppErrorOptions {
  code: string;
  message: string;
  category: ErrorCategory;
  httpStatus: number;
  /** Whether the runtime/workflow policy may retry this operation. */
  retryable: boolean;
  /** Safe, structured details exposed to authenticated clients. */
  details?: Record<string, unknown>;
  cause?: unknown;
}

export class AppError extends Error {
  readonly code: string;
  readonly category: ErrorCategory;
  readonly httpStatus: number;
  readonly retryable: boolean;
  readonly details: Record<string, unknown> | undefined;

  constructor(options: AppErrorOptions) {
    super(options.message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'AppError';
    this.code = options.code;
    this.category = options.category;
    this.httpStatus = options.httpStatus;
    this.retryable = options.retryable;
    this.details = options.details;
  }
}

// ---------------------------------------------------------------------------
// Stable error codes (see docs/API.md for the client-facing contract)
// ---------------------------------------------------------------------------

export const ErrorCode = {
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  AUTHENTICATION_REQUIRED: 'AUTHENTICATION_REQUIRED',
  TOKEN_INVALID: 'TOKEN_INVALID',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  IDEMPOTENCY_KEY_REUSED: 'IDEMPOTENCY_KEY_REUSED',
  IDEMPOTENCY_IN_PROGRESS: 'IDEMPOTENCY_IN_PROGRESS',
  INVALID_STATE_TRANSITION: 'INVALID_STATE_TRANSITION',
  CONCURRENT_MODIFICATION: 'CONCURRENT_MODIFICATION',
  RUN_NOT_CANCELLABLE: 'RUN_NOT_CANCELLABLE',
  POLICY_DENIED: 'POLICY_DENIED',
  APPROVAL_NOT_PENDING: 'APPROVAL_NOT_PENDING',
  APPROVAL_EXPIRED: 'APPROVAL_EXPIRED',
  APPROVAL_HASH_MISMATCH: 'APPROVAL_HASH_MISMATCH',
  SEPARATION_OF_DUTIES: 'SEPARATION_OF_DUTIES',
  SETTLEMENT_PRECONDITION_FAILED: 'SETTLEMENT_PRECONDITION_FAILED',
  SETTLEMENT_OUTCOME_UNKNOWN: 'SETTLEMENT_OUTCOME_UNKNOWN',
  TOOL_NOT_REGISTERED: 'TOOL_NOT_REGISTERED',
  TOOL_ARGUMENT_INVALID: 'TOOL_ARGUMENT_INVALID',
  TOOL_EXECUTION_FAILED: 'TOOL_EXECUTION_FAILED',
  TOOL_CALL_BUDGET_EXCEEDED: 'TOOL_CALL_BUDGET_EXCEEDED',
  TOKEN_BUDGET_EXCEEDED: 'TOKEN_BUDGET_EXCEEDED',
  EXECUTION_DEADLINE_EXCEEDED: 'EXECUTION_DEADLINE_EXCEEDED',
  MODEL_OUTPUT_INVALID: 'MODEL_OUTPUT_INVALID',
  PROVIDER_ERROR: 'PROVIDER_ERROR',
  PROVIDER_TIMEOUT: 'PROVIDER_TIMEOUT',
  QUEUE_UNAVAILABLE: 'QUEUE_UNAVAILABLE',
  SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
} as const;

export type ErrorCodeValue = (typeof ErrorCode)[keyof typeof ErrorCode];

// ---------------------------------------------------------------------------
// Constructors
// ---------------------------------------------------------------------------

export const validationFailed = (message: string, details?: Record<string, unknown>): AppError =>
  new AppError({
    code: ErrorCode.VALIDATION_FAILED,
    message,
    category: 'VALIDATION',
    httpStatus: 400,
    retryable: false,
    ...(details ? { details } : {}),
  });

export const unprocessable = (
  code: ErrorCodeValue,
  message: string,
  details?: Record<string, unknown>,
): AppError =>
  new AppError({
    code,
    message,
    category: 'POLICY',
    httpStatus: 422,
    retryable: false,
    ...(details ? { details } : {}),
  });

export const unauthorized = (message = 'Authentication is required.', code: ErrorCodeValue = ErrorCode.AUTHENTICATION_REQUIRED): AppError =>
  new AppError({ code, message, category: 'AUTHORIZATION', httpStatus: 401, retryable: false });

export const forbidden = (message = 'The caller is not permitted to perform this operation.'): AppError =>
  new AppError({ code: ErrorCode.FORBIDDEN, message, category: 'AUTHORIZATION', httpStatus: 403, retryable: false });

export const notFound = (message = 'The requested resource does not exist.'): AppError =>
  new AppError({ code: ErrorCode.NOT_FOUND, message, category: 'VALIDATION', httpStatus: 404, retryable: false });

export const conflict = (code: ErrorCodeValue, message: string, details?: Record<string, unknown>): AppError =>
  new AppError({
    code,
    message,
    category: 'CONFLICT',
    httpStatus: 409,
    retryable: false,
    ...(details ? { details } : {}),
  });

export const budgetExceeded = (code: ErrorCodeValue, message: string): AppError =>
  new AppError({ code, message, category: 'BUDGET', httpStatus: 429, retryable: false });

export const providerError = (message: string, cause?: unknown): AppError =>
  new AppError({ code: ErrorCode.PROVIDER_ERROR, message, category: 'PROVIDER', httpStatus: 503, retryable: true, cause });

export const providerTimeout = (message: string, cause?: unknown): AppError =>
  new AppError({ code: ErrorCode.PROVIDER_TIMEOUT, message, category: 'TIMEOUT', httpStatus: 504, retryable: true, cause });

export const transient = (message: string, cause?: unknown): AppError =>
  new AppError({ code: ErrorCode.SERVICE_UNAVAILABLE, message, category: 'TRANSIENT', httpStatus: 503, retryable: true, cause });

export const internal = (message: string, cause?: unknown): AppError =>
  new AppError({ code: ErrorCode.INTERNAL_ERROR, message, category: 'INTERNAL', httpStatus: 500, retryable: false, cause });

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}

/** Normalises anything thrown into an AppError without leaking internals. */
export function toAppError(error: unknown): AppError {
  if (isAppError(error)) return error;
  const message = error instanceof Error ? error.message : 'Unexpected internal failure.';
  return internal(message, error);
}
