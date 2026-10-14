/**
 * HTTP error contract — SRS §4.1 and §8.
 *
 * Every failure is returned with a stable machine-readable code, a safe message,
 * optional structured details and the correlation id, so a client can branch on
 * the code and an operator can find the same request in the logs.
 */
import { ZodError } from 'zod';
import { AppError, ErrorCode, toAppError } from '../../domain/errors.js';

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    category: string;
    details?: Record<string, unknown>;
    requestId?: string;
  };
}

export function toErrorResponse(error: unknown, requestId?: string): { status: number; body: ApiErrorBody } {
  const appError = normalize(error);
  return {
    status: appError.httpStatus,
    body: {
      error: {
        code: appError.code,
        message: appError.message,
        category: appError.category,
        ...(appError.details ? { details: appError.details } : {}),
        ...(requestId ? { requestId } : {}),
      },
    },
  };
}

export function normalize(error: unknown): AppError {
  if (error instanceof ZodError) {
    return new AppError({
      code: ErrorCode.VALIDATION_FAILED,
      message: 'The request payload failed validation.',
      category: 'VALIDATION',
      httpStatus: 400,
      retryable: false,
      details: {
        issues: error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
      },
    });
  }
  // Fastify's own body-parse / content-type failures.
  if (typeof error === 'object' && error !== null) {
    const statusCode = (error as { statusCode?: number }).statusCode;
    if (typeof statusCode === 'number' && statusCode >= 400 && statusCode < 500) {
      return new AppError({
        code: ErrorCode.VALIDATION_FAILED,
        message: (error as { message?: string }).message ?? 'Malformed request.',
        category: 'VALIDATION',
        httpStatus: statusCode,
        retryable: false,
      });
    }
  }
  const appError = toAppError(error);
  if (appError.code === ErrorCode.INTERNAL_ERROR) {
    // Never leak an internal stack or driver message to a client.
    return new AppError({
      code: ErrorCode.INTERNAL_ERROR,
      message: 'An unexpected internal error occurred.',
      category: 'INTERNAL',
      httpStatus: 500,
      retryable: false,
      cause: appError,
    });
  }
  return appError;
}
