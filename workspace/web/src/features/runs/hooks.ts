'use client';

import { useMemo } from 'react';
import { useMutation, useQuery, useQueryClient, useQueries } from '@tanstack/react-query';
import { queryKeys, shouldRetryRequest } from '@/lib/query-client';
import type { AuditRecord, Run, RunEvent, RunHistory, RunStep } from '@/types/api';
import { cancelRun, getRun, getRunAudit, getRunEvents, getRunHistory, getRunSteps, listRuns, submitRun, type SubmitRunInput } from './api';
import type { RunHistoryEntry } from './aggregate';

const LIST_LIMIT = 100;

export function useRuns(limit = LIST_LIMIT) {
  return useQuery<Run[]>({
    queryKey: queryKeys.runs(limit),
    queryFn: ({ signal }) => listRuns(limit, signal),
  });
}

export function useRun(runId: string | null) {
  return useQuery<Run>({
    queryKey: queryKeys.run(runId ?? 'none'),
    queryFn: ({ signal }) => getRun(runId as string, signal),
    enabled: Boolean(runId),
  });
}

export function useRunSteps(runId: string | null) {
  return useQuery<RunStep[]>({
    queryKey: queryKeys.runSteps(runId ?? 'none'),
    queryFn: ({ signal }) => getRunSteps(runId as string, signal),
    enabled: Boolean(runId),
  });
}

export function useRunEvents(runId: string | null) {
  return useQuery<RunEvent[]>({
    queryKey: queryKeys.runEvents(runId ?? 'none'),
    queryFn: ({ signal }) => getRunEvents(runId as string, undefined, signal),
    enabled: Boolean(runId),
  });
}

export function useRunAudit(runId: string | null) {
  return useQuery<AuditRecord[]>({
    queryKey: queryKeys.runAudit(runId ?? 'none'),
    queryFn: ({ signal }) => getRunAudit(runId as string, signal),
    enabled: Boolean(runId),
  });
}

export function useRunHistory(runId: string | null) {
  return useQuery<RunHistory>({
    queryKey: queryKeys.runHistory(runId ?? 'none'),
    queryFn: ({ signal }) => getRunHistory(runId as string, signal),
    enabled: Boolean(runId),
  });
}

export interface SubmittableRun extends SubmitRunInput {
  /** Reused when retrying the same logical submission (FDD §7.2). */
  idempotencyKey: string;
}

export function useSubmitRun() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ idempotencyKey, ...input }: SubmittableRun) => submitRun(input, idempotencyKey),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['runs'] });
    },
  });
}

export function useCancelRun(runId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => cancelRun(runId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.run(runId) });
      void queryClient.invalidateQueries({ queryKey: ['runs'] });
    },
  });
}

/**
 * Loads the history of each visible run in parallel.
 *
 * Bounded by the run list the console already fetched (≤100), and each request is
 * the backend's own per-run endpoint — the frontend never asks for more than the
 * API exposes.
 */
export function useRunHistories(runs: readonly Run[] | undefined) {
  const ids = useMemo(() => (runs ?? []).map((run) => run.runId), [runs]);
  const results = useQueries({
    queries: ids.map((runId) => ({
      queryKey: queryKeys.runHistory(runId),
      queryFn: ({ signal }: { signal: AbortSignal }) => getRunHistory(runId, signal),
      staleTime: 15_000,
      retry: shouldRetryRequest,
    })),
  });

  const entries = useMemo<RunHistoryEntry[]>(() => {
    const joined: RunHistoryEntry[] = [];
    results.forEach((result, index) => {
      const runId = ids[index];
      if (runId && result.data) joined.push({ runId, history: result.data });
    });
    return joined;
  }, [results, ids]);

  return {
    entries,
    isLoading: results.some((result) => result.isPending),
    completed: results.filter((result) => result.isSuccess).length,
    total: ids.length,
    isError: results.length > 0 && results.every((result) => result.isError),
    refetch: () => Promise.all(results.map((result) => result.refetch())),
  };
}

/** Loads the audit trail of each visible run in parallel (FDD §7.9). */
export function useRunAudits(runs: readonly Run[] | undefined) {
  const ids = useMemo(() => (runs ?? []).map((run) => run.runId), [runs]);
  const results = useQueries({
    queries: ids.map((runId) => ({
      queryKey: queryKeys.runAudit(runId),
      queryFn: ({ signal }: { signal: AbortSignal }) => getRunAudit(runId, signal),
      staleTime: 15_000,
      retry: shouldRetryRequest,
    })),
  });

  const entries = useMemo(() => {
    const joined: { runId: string; audit: AuditRecord[] }[] = [];
    results.forEach((result, index) => {
      const runId = ids[index];
      if (runId && result.data) joined.push({ runId, audit: result.data });
    });
    return joined;
  }, [results, ids]);

  return {
    entries,
    isLoading: results.some((result) => result.isPending),
    isError: results.length > 0 && results.every((result) => result.isError),
    refetch: () => Promise.all(results.map((result) => result.refetch())),
  };
}
