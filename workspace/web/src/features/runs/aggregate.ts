/**
 * Pure derivations over the run list (FDD §7.1).
 *
 * These are the functions the dashboard's summary cards and table filters use.
 * They are pure so the "does the console invent a number?" question has a
 * code-level answer: every value here is a count over API responses, and an
 * unavailable dataset yields `null` rather than `0`.
 */
import type { Run, RunEvent, RunHistory, RunStep } from '@/types/api';
import { STEP_TYPE_LABELS } from '@/lib/status';

export interface RunSummary {
  total: number;
  active: number;
  awaitingApproval: number;
  completed: number;
  failed: number;
  cancelled: number;
}

export function sortRunsByCreatedDesc(runs: readonly Run[]): Run[] {
  return [...runs].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
}

export function summarizeRuns(runs: readonly Run[]): RunSummary {
  const summary: RunSummary = {
    total: runs.length,
    active: 0,
    awaitingApproval: 0,
    completed: 0,
    failed: 0,
    cancelled: 0,
  };
  for (const run of runs) {
    if (run.status === 'PENDING' || run.status === 'RUNNING') summary.active += 1;
    else if (run.status === 'REQUIRES_HUMAN_APPROVAL') summary.awaitingApproval += 1;
    else if (run.status === 'COMPLETED') summary.completed += 1;
    else if (run.status === 'FAILED') summary.failed += 1;
    else if (run.status === 'CANCELLED') summary.cancelled += 1;
  }
  return summary;
}

/** Request text used as a table's "request summary" column. */
export function runRequestSummary(run: Run, maxLength = 90): string {
  const task = run.request?.task ?? '';
  return task.length > maxLength ? `${task.slice(0, maxLength - 1)}…` : task;
}

export interface RunFilter {
  status: 'ALL' | Run['status'];
  query: string;
}

export function filterRuns(runs: readonly Run[], filter: RunFilter): Run[] {
  const needle = filter.query.trim().toLowerCase();
  return runs.filter((run) => {
    if (filter.status !== 'ALL' && run.status !== filter.status) return false;
    if (!needle) return true;
    return (
      run.runId.toLowerCase().includes(needle) ||
      run.request?.task?.toLowerCase().includes(needle) === true ||
      run.taskType.toLowerCase().includes(needle)
    );
  });
}

/** Elapsed execution time; a run that never started reports "—". */
export function runDurationMs(run: Run): number | null {
  if (!run.startedAt) return null;
  const start = Date.parse(run.startedAt);
  const end = run.completedAt ? Date.parse(run.completedAt) : Date.now();
  if (Number.isNaN(start) || Number.isNaN(end)) return null;
  return Math.max(0, end - start);
}

/** Count of proposals that demanded a human decision. */
export function countProposalsRequiringApproval(run: Run): number {
  return run.result?.report.proposalIds?.length ?? 0;
}

export interface RunHistoryEntry {
  runId: string;
  history: RunHistory;
}

/** Joins run ids with their histories, dropping any that failed to load. */
export function joinHistories(entries: readonly (RunHistoryEntry | null)[]): RunHistoryEntry[] {
  return entries.filter((entry): entry is RunHistoryEntry => entry !== null);
}

/** Runs whose history must be inspected to build a global inbox. */
export function runsWithApprovalHistory(runs: readonly Run[]): Run[] {
  return runs.filter((run) => run.status === 'REQUIRES_HUMAN_APPROVAL' || run.status === 'COMPLETED' || run.status === 'FAILED');
}

/**
 * Merges the durable event history with events received live, de-duplicated by
 * event id and ordered by sequence (FDD §7.4: duplicate events must not produce
 * duplicate timeline entries).
 */
export function mergeRunEvents(
  durable: readonly RunEvent[],
  live: readonly { id: string; sequence: number; eventType: string; payload: Record<string, unknown>; createdAt: string; version?: number }[],
): RunEvent[] {
  const byId = new Map<string, RunEvent>();
  for (const event of durable) byId.set(event.eventId, event);
  for (const event of live) {
    if (byId.has(event.id)) continue;
    byId.set(event.id, {
      eventId: event.id,
      sequence: event.sequence,
      type: event.eventType,
      version: event.version ?? 1,
      payload: event.payload,
      createdAt: event.createdAt,
    });
  }
  return [...byId.values()].sort((a, b) => a.sequence - b.sequence);
}

/** Short human label for a step row in the workflow progress list. */
export function stepTitle(step: Pick<RunStep, 'type'>): string {
  return STEP_TYPE_LABELS[step.type as keyof typeof STEP_TYPE_LABELS] ?? step.type;
}

/** Right-hand metadata for a step: tool name, policy outcome, latency. */
export function stepMetaLabel(step: RunStep): string | undefined {
  const payload = step.payload ?? {};
  const parts: string[] = [];
  const toolName = payload.toolName ?? payload.tool;
  if (typeof toolName === 'string') parts.push(toolName);
  if (typeof payload.outcome === 'string') parts.push(`policy ${payload.outcome}`);
  if (typeof payload.policyVersion === 'string') parts.push(payload.policyVersion);
  if (step.latencyMs !== null) parts.push(`${Math.round(step.latencyMs)} ms`);
  if (step.errorCode) parts.push(step.errorCode);
  return parts.length > 0 ? parts.join(' · ') : undefined;
}

/** Event types that represent a refusal or failure rather than progress. */
export function eventOutcomeStatus(eventType: string): 'FAILED' | 'SUCCEEDED' {
  return /denied|failed|error/.test(eventType) ? 'FAILED' : 'SUCCEEDED';
}
