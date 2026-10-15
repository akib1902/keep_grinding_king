'use client';

import { useQueries, useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { queryKeys } from '@/lib/query-client';
import type { LedgerOperation, ProposalDetail } from '@/types/api';
import { getLedgerOperation } from '@/features/ledger/api';
import { getProposal } from './api';

export function useProposal(proposalId: string | null) {
  return useQuery<ProposalDetail>({
    queryKey: queryKeys.proposal(proposalId ?? 'none'),
    queryFn: ({ signal }) => getProposal(proposalId as string, signal),
    enabled: Boolean(proposalId),
  });
}

export function useLedgerOperation(operationId: string | null) {
  return useQuery<LedgerOperation>({
    queryKey: queryKeys.ledgerOperation(operationId ?? 'none'),
    queryFn: ({ signal }) => getLedgerOperation(operationId as string, signal),
    enabled: Boolean(operationId),
  });
}

/**
 * Enriches the ledger rows on the current page with the authoritative settlement
 * operation, which is where the commit timestamp and ledger entry hash live.
 * Only the visible page is fetched, so the console stays bounded.
 */
export function useLedgerOperationDetails(operationIds: readonly string[]) {
  const ids = useMemo(() => [...operationIds], [operationIds]);
  const results = useQueries({
    queries: ids.map((operationId) => ({
      queryKey: queryKeys.ledgerOperation(operationId),
      queryFn: ({ signal }: { signal: AbortSignal }) => getLedgerOperation(operationId, signal),
      staleTime: 30_000,
      retry: false,
    })),
  });

  const operations = useMemo(() => {
    const map = new Map<string, LedgerOperation>();
    results.forEach((result, index) => {
      const id = ids[index];
      if (id && result.data) map.set(id, result.data);
    });
    return map;
  }, [results, ids]);

  return { operations, isLoading: results.some((result) => result.isPending) };
}
