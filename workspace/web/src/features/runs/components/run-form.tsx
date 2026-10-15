'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, Input, Select, Textarea } from '@/components/ui/field';
import { useToast } from '@/components/feedback/toast';
import { useSubmitRun } from '@/features/runs/hooks';
import { ApiError, describeApiError } from '@/lib/errors';
import { DEFAULT_CURRENCY, SUPPORTED_CURRENCIES, TASK_TYPES } from '@/lib/currencies';
import {
  DEFAULT_RUN_WINDOW,
  EXAMPLE_TASK,
  hasErrors,
  mapBackendValidationError,
  newIdempotencyKey,
  validateRunForm,
  type RunFormErrors,
  type RunFormValues,
} from '@/features/runs/validation';
import type { TaskType } from '@/types/api';

const INITIAL_VALUES: RunFormValues = {
  task: '',
  taskType: 'SPEND_ANOMALY_RESEARCH',
  from: DEFAULT_RUN_WINDOW.from,
  to: DEFAULT_RUN_WINDOW.to,
  currency: DEFAULT_CURRENCY,
  notes: '',
};

/**
 * New research run form (FDD §7.2).
 *
 * The submission is idempotent by construction: one key is generated per logical
 * request and reused for retries after an uncertain outcome, so a timeout cannot
 * silently create two runs. The key is only replaced when the user starts a new
 * logical submission (after a rejected one, or by clearing the form).
 */
export function RunForm() {
  const router = useRouter();
  const toast = useToast();
  const submit = useSubmitRun();

  const [values, setValues] = useState<RunFormValues>(INITIAL_VALUES);
  const [errors, setErrors] = useState<RunFormErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [uncertain, setUncertain] = useState<string | null>(null);
  const idempotencyKey = useRef<string>(newIdempotencyKey());

  const update = <K extends keyof RunFormValues>(field: K, value: RunFormValues[K]): void => {
    setValues((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: undefined }));
  };

  const resetSubmission = (): void => {
    idempotencyKey.current = newIdempotencyKey();
    setUncertain(null);
    setFormError(null);
  };

  const send = async (): Promise<void> => {
    setFormError(null);
    const validation = validateRunForm(values);
    setErrors(validation);
    if (hasErrors(validation)) return;

    try {
      const result = await submit.mutateAsync({
        task: values.task.trim(),
        taskType: values.taskType,
        from: values.from,
        to: values.to,
        currency: values.currency.toUpperCase(),
        ...(values.notes.trim() ? { notes: values.notes.trim() } : {}),
        idempotencyKey: idempotencyKey.current,
      });
      setUncertain(null);
      toast.toast({
        tone: 'success',
        title: result.idempotentReplay ? 'Identical request already accepted' : 'Research request accepted',
        description: `Run ${result.runId.slice(0, 8)} is ${result.status.toLowerCase()}. Opening it now.`,
      });
      router.push(`/runs/${result.runId}`);
    } catch (error) {
      if (error instanceof ApiError && error.status === 0) {
        // Outcome unknown: keep the key so a retry resolves the original request.
        setUncertain(describeApiError(error));
        return;
      }
      if (error instanceof ApiError && (error.status === 400 || error.status === 422)) {
        const mapped = mapBackendValidationError(error.message);
        setErrors(mapped.fieldErrors);
        setFormError(mapped.formError);
        // A definitively rejected request is a new logical submission.
        idempotencyKey.current = newIdempotencyKey();
        return;
      }
      setFormError(describeApiError(error));
    }
  };

  const pending = submit.isPending;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Research request</CardTitle>
      </CardHeader>
      <CardContent>
        <form
          className="flex flex-col gap-5"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            void send();
          }}
        >
          <Field
            label="Task description"
            htmlFor="run-task"
            required
            hint={`At least 10 characters. Example: “${EXAMPLE_TASK.slice(0, 80)}…”`}
            error={errors.task}
          >
            <Textarea
              id="run-task"
              value={values.task}
              onChange={(event) => update('task', event.target.value)}
              maxLength={2000}
              aria-invalid={errors.task ? true : undefined}
              placeholder={EXAMPLE_TASK}
              required
            />
          </Field>

          <div className="flex flex-wrap items-center gap-2">
            <Button variant="secondary" size="sm" onClick={() => update('task', EXAMPLE_TASK)} disabled={pending}>
              Use the example task
            </Button>
            <span className="text-xs text-muted">Fills the field with the reference spend-anomaly request.</span>
          </div>

          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="Task type" htmlFor="run-task-type">
              <Select
                id="run-task-type"
                value={values.taskType}
                onChange={(event) => update('taskType', event.target.value as TaskType)}
              >
                {TASK_TYPES.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label="Currency" htmlFor="run-currency" error={errors.currency} required>
              <Select id="run-currency" value={values.currency} onChange={(event) => update('currency', event.target.value)}>
                {SUPPORTED_CURRENCIES.map((currency) => (
                  <option key={currency} value={currency}>
                    {currency}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label="Analysis period start" htmlFor="run-from" required error={errors.from}>
              <Input
                id="run-from"
                type="date"
                value={values.from}
                onChange={(event) => update('from', event.target.value)}
                aria-invalid={errors.from ? true : undefined}
                required
              />
            </Field>

            <Field label="Analysis period end" htmlFor="run-to" required error={errors.to}>
              <Input
                id="run-to"
                type="date"
                value={values.to}
                onChange={(event) => update('to', event.target.value)}
                aria-invalid={errors.to ? true : undefined}
                required
              />
            </Field>
          </div>

          <Field label="Notes (optional)" htmlFor="run-notes" error={errors.notes} hint="Stored with the request. Keep it free of credentials.">
            <Textarea
              id="run-notes"
              value={values.notes}
              onChange={(event) => update('notes', event.target.value.slice(0, 1000))}
              maxLength={1000}
              className="min-h-16"
            />
          </Field>

          {formError ? (
            <Alert tone="danger" role="alert" title="The request was rejected">
              {formError}
            </Alert>
          ) : null}

          {uncertain ? (
            <Alert tone="warning" role="alert" title="The outcome of this submission is unknown">
              <p className="flex flex-col gap-2">
                <span>{uncertain}</span>
                <span>
                  The console will <strong>not</strong> create a second logical run with a new idempotency key. Retrying below replays the same
                  key (<code className="font-mono">{idempotencyKey.current.slice(0, 8)}</code>), so if the backend already accepted the request
                  you get that same run back.
                </span>
              </p>
            </Alert>
          ) : null}

          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" disabled={pending}>
              {pending ? 'Submitting…' : uncertain ? 'Retry the same request' : 'Submit research request'}
            </Button>
            {uncertain ? (
              <Button
                variant="secondary"
                onClick={() => {
                  resetSubmission();
                }}
                disabled={pending}
              >
                Start a different request
              </Button>
            ) : (
              <Button
                variant="ghost"
                onClick={() => {
                  setValues(INITIAL_VALUES);
                  setErrors({});
                  resetSubmission();
                }}
                disabled={pending}
              >
                Clear form
              </Button>
            )}
          </div>

          <p className="text-xs text-muted">
            Submission returns an accepted run id immediately; execution happens asynchronously in the worker. The console then follows the run
            over its durable event stream.
          </p>
        </form>
      </CardContent>
    </Card>
  );
}
