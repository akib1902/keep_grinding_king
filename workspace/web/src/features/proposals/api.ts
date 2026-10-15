import { apiGet } from '@/lib/api-client';
import { proposalDetailSchema } from '@/lib/schemas';
import type { ProposalDetail } from '@/types/api';

export async function getProposal(proposalId: string, signal?: AbortSignal): Promise<ProposalDetail> {
  return apiGet<ProposalDetail>(`/api/refund-proposals/${proposalId}`, { signal }, {
    parse: (value) => proposalDetailSchema.parse(value) as ProposalDetail,
  });
}
