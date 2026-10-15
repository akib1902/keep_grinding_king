'use client';

import { useMemo } from 'react';
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query-client';
import type { ApprovalDetail } from '@/types/api';
import { decideApproval, getApproval, type DecideApprovalInput } from './api';
import type { ApprovalRow } from './rows';

export function useApproval(approvalId: string | null) {
  return useQuery<ApprovalDetail>({
    queryKey: queryKeys.approval(approvalId ?? 'none'),
    queryFn: ({ signal }) => getApproval(approvalId as string, signal),
    enabled: Boolean(approvalId),
  });
}

/**
 * Loads the authoritative detail for the rows currently visible in the inbox.
 * Supplier identity, expiry and decision status come from the approval record
 * itself rather than from the proposal join.
 */
export function useApprovalDetails(rows: readonly ApprovalRow[]) {
  const ids = useMemo(() => rows.map((row) => row.approvalId), [rows]);
  const results = useQueries({
    queries: ids.map((approvalId) => ({
      queryKey: queryKeys.approval(approvalId),
      queryFn: ({ signal }: { signal: AbortSignal }) => getApproval(approvalId, signal),
      staleTime: 15_000,
      retry: false,
    })),
  });

  const details = useMemo(() => {
    const map = new Map<string, ApprovalDetail>();
    results.forEach((result, index) => {
      const id = ids[index];
      if (id && result.data) map.set(id, result.data);
    });
    return map;
  }, [results, ids]);

  return {
    details,
    isLoading: results.some((result) => result.isPending),
    isError: results.length > 0 && results.every((result) => result.isError),
  };
}

/**
 * Records a decision. On success the approval, its run, the proposal, the run
 * history and the run lists are invalidated — the decision resumes the workflow
 * in the background, so the console re-reads rather than assuming.
 */
export function useDecideApproval() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: DecideApprovalInput) => decideApproval(input),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.approval(result.approvalId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.proposal(result.proposalId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.run(result.runId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.runHistory(result.runId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.runAudit(result.runId) });
      void queryClient.invalidateQueries({ queryKey: ['runs'] });
      void queryClient.invalidateQueries({ queryKey: ['approval'] });
    },
  });
}
