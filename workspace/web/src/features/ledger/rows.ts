/**
 * Settlement ledger rows (FDD §7.8).
 *
 * Two facts shape this module. First, the per-run history endpoint lists
 * settlement *operations* without their proposal id, so the amount and currency
 * come from the run's final report and the supplier/proposal are resolved from
 * the authoritative operation endpoint for the rows actually displayed. Second,
 * a proposal that was merely approved produces no row: only a recorded settlement
 * operation appears here, always labelled simulated.
 */
import type { Run, SettlementStatus } from '@/types/api';
import type { RunHistoryEntry } from '@/features/runs/aggregate';

export interface LedgerRow {
  operationId: string;
  runId: string;
  status: SettlementStatus;
  attempts: number | null;
  ledgerEntryId: string | null;
  /** From the run's report; `null` when the report does not carry it. */
  amountMinor: number | null;
  currency: string | null;
  /** Resolved from the operation endpoint for the visible page. */
  supplierId: string | null;
  proposalId: string | null;
  /** When the run finished, used for date filtering when nothing better exists. */
  requestedAt: string | null;
}

export function buildLedgerRows(runs: readonly Run[], entries: readonly RunHistoryEntry[]): LedgerRow[] {
  const byId = new Map(runs.map((run) => [run.runId, run]));
  const rows: LedgerRow[] = [];
  for (const { runId, history } of entries) {
    const run = byId.get(runId);
    const reportSettlement = run?.result?.report.settlement ?? null;
    for (const settlement of history.settlements) {
      // Prefer the report's figure only when it describes the same operation.
      const matches = reportSettlement?.operationId === settlement.operationId;
      rows.push({
        operationId: settlement.operationId,
        runId,
        status: settlement.status,
        attempts: settlement.attempts,
        ledgerEntryId: settlement.ledgerEntryId,
        amountMinor: matches ? (reportSettlement?.amountMinor ?? null) : null,
        currency: matches ? (reportSettlement?.currency ?? null) : null,
        supplierId: null,
        proposalId: null,
        requestedAt: run?.completedAt ?? run?.createdAt ?? null,
      });
    }
  }
  return rows.sort((a, b) => (b.requestedAt ?? '').localeCompare(a.requestedAt ?? ''));
}

export function filterLedgerRows(
  rows: readonly LedgerRow[],
  filter: { status: 'ALL' | SettlementStatus; query: string; from?: string; to?: string },
): LedgerRow[] {
  const needle = filter.query.trim().toLowerCase();
  const fromTime = filter.from ? Date.parse(`${filter.from}T00:00:00Z`) : null;
  const toTime = filter.to ? Date.parse(`${filter.to}T23:59:59Z`) : null;
  return rows.filter((row) => {
    if (filter.status !== 'ALL' && row.status !== filter.status) return false;
    if (row.requestedAt) {
      const at = Date.parse(row.requestedAt);
      if (fromTime !== null && !Number.isNaN(fromTime) && at < fromTime) return false;
      if (toTime !== null && !Number.isNaN(toTime) && at > toTime) return false;
    }
    if (!needle) return true;
    return (
      row.operationId.toLowerCase().includes(needle) ||
      row.runId.toLowerCase().includes(needle) ||
      (row.proposalId?.toLowerCase().includes(needle) ?? false) ||
      (row.ledgerEntryId?.toLowerCase().includes(needle) ?? false)
    );
  });
}

/**
 * A row may only be presented as a settled ledger entry when the operation
 * committed *and* carries the ledger entry id the backend wrote.
 */
export function isCommittedLedgerEntry(row: LedgerRow): boolean {
  return row.status === 'COMMITTED' && row.ledgerEntryId !== null;
}
