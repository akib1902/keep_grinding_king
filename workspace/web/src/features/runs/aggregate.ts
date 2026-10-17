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

/** Parses a `YYYY-MM-DD` request date as UTC, rejecting impossible dates. */
function parseIsoDate(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const [, year, month, day] = match;
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  const roundTrips =
    date.getUTCFullYear() === Number(year) && date.getUTCMonth() === Number(month) - 1 && date.getUTCDate() === Number(day);
  return roundTrips ? date : null;
}

/**
 * Label for the analysis window: `Q3 2026` when the request covers exactly one
 * calendar quarter, otherwise the literal range. Derived from the recorded
 * request dates, never guessed from the task text.
 */
export function analysisWindowLabel(from: string | undefined, to: string | undefined): string | null {
  if (!from || !to) return null;
  const start = parseIsoDate(from);
  const end = parseIsoDate(to);
  if (!start || !end) return null;
  if (start.getUTCDate() !== 1 || start.getUTCMonth() % 3 !== 0) return `${from} → ${to}`;
  if (end.getUTCFullYear() !== start.getUTCFullYear() || end.getUTCMonth() !== start.getUTCMonth() + 2) {
    return `${from} → ${to}`;
  }
  const lastDayOfQuarter = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() + 1, 0)).getUTCDate();
  return end.getUTCDate() === lastDayOfQuarter
    ? `Q${start.getUTCMonth() / 3 + 1} ${start.getUTCFullYear()}`
    : `${from} → ${to}`;
}

const TASK_PURPOSE: Record<string, string> = {
  SPEND_ANOMALY_RESEARCH: 'spending analysis',
  SUPPLIER_DISCREPANCY_REVIEW: 'supplier discrepancy review',
};

/**
 * Short human headline for a run, e.g. "Q3 2026 spending analysis".
 *
 * A page heading is not the place for a truncated prompt: the full request text
 * stays visible in the run summary, and this label is built only from recorded
 * request fields so the console never invents a title.
 */
export function runHeadline(run: Pick<Run, 'taskType' | 'request'>): string {
  const purpose = TASK_PURPOSE[run.taskType] ?? 'research run';
  const window = analysisWindowLabel(run.request?.from, run.request?.to);
  return window ? `${window} ${purpose}` : purpose.charAt(0).toUpperCase() + purpose.slice(1);
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
