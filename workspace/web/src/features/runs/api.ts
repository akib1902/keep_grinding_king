/**
 * Run data access (FDD §11).
 *
 * Only documented endpoints are used, and list calls stay inside the backend's
 * own bounds (`limit` is clamped to 100 server-side).
 */
import { apiGet, apiPost } from '@/lib/api-client';
import {
  runAuditSchema,
  runEventsSchema,
  runHistorySchema,
  runListSchema,
  runSchema,
  runStepsSchema,
  submitRunResultSchema,
} from '@/lib/schemas';
import type { AuditRecord, Run, RunEvent, RunHistory, RunStep, RunStatus, SubmitRunResult, TaskType } from '@/types/api';

export interface SubmitRunInput {
  task: string;
  taskType: TaskType;
  from: string;
  to: string;
  currency: string;
  supplierIds?: string[];
  notes?: string;
}

export async function listRuns(limit = 100, signal?: AbortSignal): Promise<Run[]> {
  const data = await apiGet<{ runs: Run[] }>(
    `/api/runs?limit=${limit}`,
    { signal },
    { parse: (value) => runListSchema.parse(value) as { runs: Run[] } },
  );
  return data.runs;
}

export async function getRun(runId: string, signal?: AbortSignal): Promise<Run> {
  return apiGet<Run>(`/api/runs/${runId}`, { signal }, { parse: (value) => runSchema.parse(value) as Run });
}

export async function getRunSteps(runId: string, signal?: AbortSignal): Promise<RunStep[]> {
  const data = await apiGet<{ steps: RunStep[] }>(
    `/api/runs/${runId}/steps`,
    { signal },
    { parse: (value) => runStepsSchema.parse(value) as { steps: RunStep[] } },
  );
  return data.steps;
}

export async function getRunEvents(runId: string, afterEventId?: string, signal?: AbortSignal): Promise<RunEvent[]> {
  const data = await apiGet<{ events: RunEvent[] }>(
    `/api/runs/${runId}/events${afterEventId ? `?afterEventId=${encodeURIComponent(afterEventId)}` : ''}`,
    { signal },
    { parse: (value) => runEventsSchema.parse(value) as { events: RunEvent[] } },
  );
  return data.events;
}

export async function getRunAudit(runId: string, signal?: AbortSignal): Promise<AuditRecord[]> {
  const data = await apiGet<{ audit: AuditRecord[] }>(
    `/api/runs/${runId}/audit`,
    { signal },
    { parse: (value) => runAuditSchema.parse(value) as { audit: AuditRecord[] } },
  );
  return data.audit;
}

export async function getRunHistory(runId: string, signal?: AbortSignal): Promise<RunHistory> {
  return apiGet<RunHistory>(`/api/runs/${runId}/history`, { signal }, {
    parse: (value) => runHistorySchema.parse(value) as RunHistory,
  });
}

/**
 * Submits a research request. The caller supplies the idempotency key so a retry
 * of *the same logical submission* reuses it — the backend then returns the
 * original run instead of creating a second one.
 */
export async function submitRun(input: SubmitRunInput, idempotencyKey: string): Promise<SubmitRunResult> {
  return apiPost<SubmitRunResult>('/api/runs', input, { idempotencyKey }, {
    parse: (value) => submitRunResultSchema.parse(value) as SubmitRunResult,
  });
}

export async function cancelRun(runId: string): Promise<Run> {
  return apiPost<Run>(`/api/runs/${runId}/cancel`, undefined, {}, {
    parse: (value) => runSchema.parse(value) as Run,
  });
}

/** Statuses that mean "the console should keep listening to the stream". */
export const LIVE_RUN_STATUSES: readonly RunStatus[] = ['PENDING', 'RUNNING', 'REQUIRES_HUMAN_APPROVAL'];

export function isLiveRun(run: Pick<Run, 'status'> | null | undefined): boolean {
  return !!run && LIVE_RUN_STATUSES.includes(run.status);
}

export function isTerminalRun(run: Pick<Run, 'status'> | null | undefined): boolean {
  return (
    !!run && (run.status === 'COMPLETED' || run.status === 'FAILED' || run.status === 'CANCELLED')
  );
}
