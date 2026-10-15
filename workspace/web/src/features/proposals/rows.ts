/**
 * Refund proposal rows (FDD §7.7).
 *
 * Built from run histories so the list view matches what the backend recorded,
 * including proposals that were denied by policy (which never get an approval).
 */
import type { ApprovalStatus, ProposalStatus } from '@/types/api';
import type { RunHistoryEntry } from '@/features/runs/aggregate';

export interface ProposalRow {
  proposalId: string;
  runId: string;
  status: ProposalStatus;
  supplierId: string;
  transactionId: string;
  amountMinor: number;
  currency: string;
  policyOutcome: string;
  policyVersion: string;
  requiresApproval: boolean;
  revision: number;
  createdAt: string;
  approvalStatus: ApprovalStatus | null;
  approvalId: string | null;
  /**
   * True when the proposal itself reached the SETTLED state. Settlement details
   * (operation id, ledger entry) are read from the proposal detail endpoint,
   * because the history endpoint lists settlement operations without their
   * proposal reference.
   */
  settled: boolean;
}

export function buildProposalRows(entries: readonly RunHistoryEntry[]): ProposalRow[] {
  const rows: ProposalRow[] = [];
  for (const { runId, history } of entries) {
    const approvals = new Map(history.approvals.map((approval) => [approval.proposalId, approval]));
    for (const proposal of history.proposals) {
      const approval = approvals.get(proposal.proposalId) ?? null;
      rows.push({
        proposalId: proposal.proposalId,
        runId,
        status: proposal.status,
        supplierId: proposal.supplierId,
        transactionId: proposal.transactionId,
        amountMinor: proposal.amountMinor,
        currency: proposal.currency,
        policyOutcome: proposal.policyOutcome,
        policyVersion: proposal.policyVersion,
        requiresApproval: proposal.requiresApproval,
        revision: proposal.revision,
        createdAt: proposal.createdAt,
        approvalStatus: approval?.status ?? null,
        approvalId: approval?.approvalId ?? null,
        settled: proposal.status === 'SETTLED',
      });
    }
  }
  return rows.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
}

export function filterProposalRows(rows: readonly ProposalRow[], status: 'ALL' | ProposalStatus, query = ''): ProposalRow[] {
  const needle = query.trim().toLowerCase();
  return rows.filter((row) => {
    if (status !== 'ALL' && row.status !== status) return false;
    if (!needle) return true;
    return (
      row.proposalId.toLowerCase().includes(needle) ||
      row.runId.toLowerCase().includes(needle) ||
      row.supplierId.toLowerCase().includes(needle) ||
      row.transactionId.toLowerCase().includes(needle)
    );
  });
}

/**
 * A proposal is presented as settled only when the backend says it settled.
 * Nothing is derived from the run's status (FDD §7.8).
 */
export function isSettled(row: ProposalRow): boolean {
  return row.settled;
}
