'use client';

import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query-client';
import { getReadiness } from './api';
import type { ReadinessResponse } from '@/types/api';

/** Polls the backend readiness probe for the shell's service indicator. */
export function useReadiness(enabled = true) {
  return useQuery<ReadinessResponse>({
    queryKey: queryKeys.readiness(),
    queryFn: ({ signal }) => getReadiness(signal),
    enabled,
    staleTime: 15_000,
    refetchInterval: 30_000,
    retry: false,
  });
}
