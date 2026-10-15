/**
 * Approval data access (FDD §7.5, §7.6).
 *
 * The backend exposes approvals by id only, plus per-run history. The inbox view
 * therefore builds its rows from run history and enriches the visible rows with
 * the authoritative approval detail, never inferring a decision from run status.
 */
import { apiGet, apiPost } from '@/lib/api-client';
import { approvalDetailSchema, decisionResultSchema } from '@/lib/schemas';
import type { ApprovalDetail, DecisionResult } from '@/types/api';

export async function getApproval(approvalId: string, signal?: AbortSignal): Promise<ApprovalDetail> {
  return apiGet<ApprovalDetail>(`/api/approvals/${approvalId}`, { signal }, {
    parse: (value) => approvalDetailSchema.parse(value) as ApprovalDetail,
  });
}

export interface DecideApprovalInput {
  approvalId: string;
  decision: 'APPROVE' | 'REJECT';
  reason?: string;
}

/**
 * Records a decision. A successful response means the decision was durably
 * recorded — it does *not* mean the refund settled, and the UI says so.
 */
export async function decideApproval(input: DecideApprovalInput): Promise<DecisionResult> {
  return apiPost<DecisionResult>(
    `/api/approvals/${input.approvalId}/decision`,
    { decision: input.decision, ...(input.reason ? { reason: input.reason } : {}) },
    {},
    { parse: (value) => decisionResultSchema.parse(value) as DecisionResult },
  );
}
