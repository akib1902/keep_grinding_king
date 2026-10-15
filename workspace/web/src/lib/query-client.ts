/**
 * TanStack Query configuration (FDD §10.1).
 *
 * Defaults are chosen for an operations console:
 *  - reads are cached briefly and refetched on window focus, because the backend
 *    is the authority on run state,
 *  - a 401/403/404 is never retried (it will not become a success),
 *  - mutations are never retried, because none of them is safe to blind-retry.
 */
import { QueryClient } from '@tanstack/react-query';
import { ApiError } from './errors';

export function shouldRetryRequest(failureCount: number, error: unknown): boolean {
  if (failureCount >= 2) return false;
  if (error instanceof ApiError) {
    if (error.status === 0) return true;
    return error.retryable && error.status >= 500;
  }
  return false;
}

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 10_000,
        gcTime: 5 * 60_000,
        refetchOnWindowFocus: true,
        retry: shouldRetryRequest,
      },
      mutations: {
        retry: false,
      },
    },
  });
}

/** Query keys, centralised so invalidation stays consistent. */
export const queryKeys = {
  readiness: () => ['readiness'] as const,
  runs: (limit: number) => ['runs', limit] as const,
  run: (runId: string) => ['run', runId] as const,
  runSteps: (runId: string) => ['run', runId, 'steps'] as const,
  runEvents: (runId: string) => ['run', runId, 'events'] as const,
  runAudit: (runId: string) => ['run', runId, 'audit'] as const,
  runHistory: (runId: string) => ['run', runId, 'history'] as const,
  approval: (approvalId: string) => ['approval', approvalId] as const,
  proposal: (proposalId: string) => ['proposal', proposalId] as const,
  ledgerOperation: (operationId: string) => ['ledger-operation', operationId] as const,
};
