/**
 * Research request validation (FDD §7.2).
 *
 * Client validation exists to give immediate, field-level feedback; the backend
 * validates the same rules again and remains the authority. The error strings
 * mirror the backend's own messages where it has one, so a user never sees two
 * different explanations of the same rule.
 */
import { SUPPORTED_CURRENCIES } from '@/lib/currencies';
import type { TaskType } from '@/types/api';

export interface RunFormValues {
  task: string;
  taskType: TaskType;
  from: string;
  to: string;
  currency: string;
  notes: string;
}

export type RunFormErrors = Partial<Record<keyof RunFormValues, string>>;

export const DEFAULT_RUN_WINDOW = { from: '2026-07-01', to: '2026-09-30' } as const;

export const EXAMPLE_TASK =
  'Analyze Q3 spending anomalies, identify potential supplier overcharges, and prepare refund proposals supported by transaction evidence.';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function validateRunForm(values: RunFormValues): RunFormErrors {
  const errors: RunFormErrors = {};

  const task = values.task.trim();
  if (!task) errors.task = 'Describe the research task.';
  else if (task.length < 10) errors.task = 'Describe the research task in at least 10 characters.';
  else if (task.length > 2000) errors.task = 'The task description must be 2000 characters or fewer.';

  if (!values.from) errors.from = 'Choose the start of the analysis period.';
  else if (!ISO_DATE.test(values.from)) errors.from = 'from must be an ISO date (YYYY-MM-DD).';

  if (!values.to) errors.to = 'Choose the end of the analysis period.';
  else if (!ISO_DATE.test(values.to)) errors.to = 'to must be an ISO date (YYYY-MM-DD).';

  if (!errors.from && !errors.to && values.from > values.to) {
    errors.to = 'The analysis window is invalid: from must be on or before to.';
  }

  if (!values.currency) errors.currency = 'Choose a currency.';
  else if (!SUPPORTED_CURRENCIES.includes(values.currency.toUpperCase())) {
    errors.currency = `Unsupported currency. Supported: ${SUPPORTED_CURRENCIES.join(', ')}.`;
  }

  if (values.notes.length > 1000) errors.notes = 'Notes must be 1000 characters or fewer.';

  return errors;
}

export function hasErrors(errors: RunFormErrors): boolean {
  return Object.keys(errors).length > 0;
}

/**
 * Maps a backend validation failure onto the form. The backend reports a message
 * rather than field names, so a keyword match is used to place it on the field
 * the user needs to fix; an unmatched message is returned as a form-level error.
 */
export function mapBackendValidationError(message: string): { fieldErrors: RunFormErrors; formError: string | null } {
  const lower = message.toLowerCase();
  if (lower.includes('from must be') || lower.includes('analysis window is invalid')) {
    return { fieldErrors: { to: message }, formError: null };
  }
  if (lower.includes('idempotency')) return { fieldErrors: {}, formError: message };
  if (lower.includes('research task') || lower.includes('task')) return { fieldErrors: { task: message }, formError: null };
  if (lower.includes('currency')) return { fieldErrors: { currency: message }, formError: null };
  return { fieldErrors: {}, formError: message };
}

/**
 * Generates the idempotency key for a logical submission. Reusing the same key on
 * a retry is what makes a retried submission return the original run instead of
 * creating a second one (FDD §7.2).
 */
export function newIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `run-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}
