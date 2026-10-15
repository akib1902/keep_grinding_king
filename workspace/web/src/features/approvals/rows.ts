/**
 * Approval inbox rows (FDD §7.5).
 *
 * The backend exposes approvals individually and per-run, so the inbox is built
 * from run histories and joined on `proposalId`. A decision status is therefore
 * read from the approval record itself — never inferred from the run's status.
 */
import type { ApprovalStatus, ProposalStatus } from '@/types/api';
import type { RunHistoryEntry } from '@/features/runs/aggregate';

export interface ApprovalRow {
  approvalId: string;
  proposalId: string;
  runId: string;
  status: ApprovalStatus;
  /** `null` when the matching proposal could not be joined; the UI shows "—". */
  amountMinor: number | null;
  currency: string | null;
  supplierId: string | null;
  transactionId: string | null;
  policyOutcome: string | null;
  policyVersion: string | null;
  proposalStatus: ProposalStatus | null;
  /** When the proposal (and therefore the request) was created. */
  requestedAt: string;
  expiresAt: string;
  decidedAt: string | null;
  decidedBy: string | null;
  reason: string | null;
}

export function buildApprovalRows(entries: readonly RunHistoryEntry[]): ApprovalRow[] {
  const rows: ApprovalRow[] = [];
  for (const { runId, history } of entries) {
    const proposals = new Map(history.proposals.map((proposal) => [proposal.proposalId, proposal]));
    for (const approval of history.approvals) {
      const proposal = proposals.get(approval.proposalId);
      rows.push({
        approvalId: approval.approvalId,
        proposalId: approval.proposalId,
        runId,
        status: approval.status,
        amountMinor: proposal?.amountMinor ?? null,
        currency: proposal?.currency ?? null,
        supplierId: proposal?.supplierId ?? null,
        transactionId: proposal?.transactionId ?? null,
        policyOutcome: proposal?.policyOutcome ?? null,
        policyVersion: proposal?.policyVersion ?? null,
        proposalStatus: proposal?.status ?? null,
        requestedAt: proposal?.createdAt ?? approval.expiresAt,
        expiresAt: approval.expiresAt,
        decidedAt: approval.decidedAt,
        decidedBy: approval.decidedBy,
        reason: approval.reason,
      });
    }
  }
  return rows.sort((a, b) => Date.parse(b.requestedAt) - Date.parse(a.requestedAt));
}

export type ApprovalTab = 'PENDING' | 'APPROVED' | 'REJECTED' | 'EXPIRED';

export const APPROVAL_TABS: readonly { id: ApprovalTab; label: string }[] = [
  { id: 'PENDING', label: 'Pending' },
  { id: 'APPROVED', label: 'Approved' },
  { id: 'REJECTED', label: 'Rejected' },
  { id: 'EXPIRED', label: 'Expired' },
];

/**
 * `CANCELLED` approvals are not part of any tab in the FDD's four views, so they
 * are surfaced under "Expired" as non-actionable terminal records rather than
 * silently dropped.
 */
export function filterApprovalRows(rows: readonly ApprovalRow[], tab: ApprovalTab, query = ''): ApprovalRow[] {
  const needle = query.trim().toLowerCase();
  return rows.filter((row) => {
    const matchesTab = tab === 'EXPIRED' ? row.status === 'EXPIRED' || row.status === 'CANCELLED' : row.status === tab;
    if (!matchesTab) return false;
    if (!needle) return true;
    return (
      row.approvalId.toLowerCase().includes(needle) ||
      row.runId.toLowerCase().includes(needle) ||
      row.proposalId.toLowerCase().includes(needle) ||
      (row.supplierId?.toLowerCase().includes(needle) ?? false)
    );
  });
}

export function tabCounts(rows: readonly ApprovalRow[]): Record<ApprovalTab, number> {
  const counts: Record<ApprovalTab, number> = { PENDING: 0, APPROVED: 0, REJECTED: 0, EXPIRED: 0 };
  for (const row of rows) {
    if (row.status === 'CANCELLED') counts.EXPIRED += 1;
    else if (row.status in counts) counts[row.status as ApprovalTab] += 1;
  }
  return counts;
}

/** Rows that are safe to retry after a failed detail fetch. */
export function isActionable(row: ApprovalRow, now: Date = new Date()): boolean {
  if (row.status !== 'PENDING') return false;
  return Date.parse(row.expiresAt) > now.getTime();
}
