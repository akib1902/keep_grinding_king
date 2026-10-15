/**
 * Audit trail rows (FDD §7.9).
 *
 * The backend exposes audit records per run, so the global trail is the union of
 * the runs the user can see, ordered newest first. This view is a *reader* of the
 * recorded audit: it does not, and must not, imply that rendering a timeline
 * provides tamper-proof storage — that integrity lives in the backend.
 */
import type { AuditRecord } from '@/types/api';

export interface AuditRow extends AuditRecord {
  runId: string;
}

export function buildAuditRows(entries: readonly { runId: string; audit: readonly AuditRecord[] }[]): AuditRow[] {
  const rows: AuditRow[] = [];
  for (const { runId, audit } of entries) {
    for (const record of audit) rows.push({ ...record, runId });
  }
  return rows.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
}

export interface AuditFilter {
  runId?: string;
  action?: string;
  actorType?: string;
  operationId?: string;
  from?: string;
  to?: string;
  query?: string;
}

export const AUDIT_CATEGORY_GROUPS = {
  'Run created': ['run.submitted', 'run.queued'],
  'Run started': ['run.started'],
  'Tool failure': ['tool.failed'],
  'Policy decision': ['refund_proposal.denied_by_policy', 'refund_proposal.created'],
  'Approval requested': ['approval.requested'],
  'Approval approved or rejected': ['approval.approved', 'approval.rejected', 'approval.expired'],
  'Settlement completed': ['settlement.committed', 'settlement.requested', 'settlement.failed', 'settlement.unknown'],
  'Run failed or cancelled': ['run.failed', 'run.cancelled', 'run.requeued', 'run.awaiting_approval', 'run.completed', 'run.completed_after_decision'],
} as const;

export function filterAuditRows(rows: readonly AuditRow[], filter: AuditFilter): AuditRow[] {
  const needle = filter.query?.trim().toLowerCase() ?? '';
  const runNeedle = filter.runId?.trim().toLowerCase() ?? '';
  const operationNeedle = filter.operationId?.trim().toLowerCase() ?? '';
  const fromTime = filter.from ? Date.parse(`${filter.from}T00:00:00Z`) : null;
  const toTime = filter.to ? Date.parse(`${filter.to}T23:59:59Z`) : null;

  return rows.filter((row) => {
    if (filter.action && filter.action !== 'ALL') {
      const group = AUDIT_CATEGORY_GROUPS[filter.action as keyof typeof AUDIT_CATEGORY_GROUPS];
      if (group) {
        if (!(group as readonly string[]).includes(row.action)) return false;
      } else if (row.action !== filter.action) {
        return false;
      }
    }
    if (filter.actorType && filter.actorType !== 'ALL' && row.actorType !== filter.actorType) return false;
    if (runNeedle && !row.runId.toLowerCase().includes(runNeedle)) return false;
    if (operationNeedle) {
      const operationId = typeof row.metadata?.operationId === 'string' ? row.metadata.operationId.toLowerCase() : '';
      const targetId = row.targetId?.toLowerCase() ?? '';
      if (!operationId.includes(operationNeedle) && !targetId.includes(operationNeedle)) return false;
    }
    const createdAt = Date.parse(row.createdAt);
    if (fromTime !== null && !Number.isNaN(fromTime) && createdAt < fromTime) return false;
    if (toTime !== null && !Number.isNaN(toTime) && createdAt > toTime) return false;
    if (!needle) return true;
    return (
      row.action.toLowerCase().includes(needle) ||
      row.runId.toLowerCase().includes(needle) ||
      (row.actorId?.toLowerCase().includes(needle) ?? false) ||
      (row.targetId?.toLowerCase().includes(needle) ?? false)
    );
  });
}

/** Distinct actor types present in a set of rows, for the filter control. */
export function distinctActorTypes(rows: readonly AuditRow[]): string[] {
  return [...new Set(rows.map((row) => row.actorType))].sort();
}
