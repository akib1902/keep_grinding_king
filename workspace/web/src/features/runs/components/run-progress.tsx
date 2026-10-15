'use client';

import { ExecutionTimeline, PayloadBlock, type TimelineEntry } from '@/components/data-display/timeline';
import { EmptyState } from '@/components/data-display/states';
import { formatDurationMs } from '@/lib/formatters';
import type { RunStep } from '@/types/api';
import { stepMetaLabel, stepTitle } from '../aggregate';

/**
 * Workflow progress (FDD §7.4B).
 *
 * Every entry corresponds to a step the backend recorded, so the console cannot
 * show progress the workflow did not actually make. Steps that were recorded but
 * carry an error are marked failed, and retry information is shown with them.
 */
export function RunProgress({ steps, className }: { steps: readonly RunStep[]; className?: string }) {
  if (steps.length === 0) {
    return (
      <EmptyState
        title="No execution steps recorded yet"
        description="The run has been accepted but the worker has not recorded any step. This page will update as soon as the event stream delivers the first step."
      />
    );
  }

  const entries: TimelineEntry[] = steps.map((step) => ({
    id: step.stepId,
    title: stepTitle(step),
    status: step.status,
    meta: stepMetaLabel(step),
    timestamp: step.createdAt,
    description: step.summary ?? undefined,
    tone: step.type === 'MODEL_TURN' ? 'muted' : 'default',
    detail: <StepDetail step={step} />,
  }));

  return <ExecutionTimeline entries={entries} className={className} />;
}

function StepDetail({ step }: { step: RunStep }) {
  return (
    <dl className="flex flex-col gap-1.5 text-[11px]">
      <div className="flex gap-2">
        <dt className="w-32 shrink-0 text-muted">Step id</dt>
        <dd className="font-mono text-secondary">{step.stepId}</dd>
      </div>
      <div className="flex gap-2">
        <dt className="w-32 shrink-0 text-muted">Sequence</dt>
        <dd className="tnum text-secondary">{step.sequence}</dd>
      </div>
      {step.attemptId ? (
        <div className="flex gap-2">
          <dt className="w-32 shrink-0 text-muted">Attempt</dt>
          <dd className="font-mono text-secondary">{step.attemptId}</dd>
        </div>
      ) : null}
      <div className="flex gap-2">
        <dt className="w-32 shrink-0 text-muted">Duration</dt>
        <dd className="tnum text-secondary">{formatDurationMs(step.latencyMs)}</dd>
      </div>
      {step.retryable !== null ? (
        <div className="flex gap-2">
          <dt className="w-32 shrink-0 text-muted">Retryable</dt>
          <dd className="text-secondary">{step.retryable ? 'yes — the workflow policy may retry' : 'no — retrying would not help'}</dd>
        </div>
      ) : null}
      {step.errorCode ? (
        <div className="flex gap-2">
          <dt className="w-32 shrink-0 text-muted">Error</dt>
          <dd className="font-mono text-danger">
            {step.errorCode}
            {step.errorMessage ? ` — ${step.errorMessage}` : ''}
          </dd>
        </div>
      ) : null}
      {step.payload ? (
        <div className="mt-1 flex flex-col gap-1">
          <dt className="text-muted">Payload</dt>
          <dd>
            <PayloadBlock value={step.payload} />
          </dd>
        </div>
      ) : null}
    </dl>
  );
}
