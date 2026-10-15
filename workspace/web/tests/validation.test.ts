import { describe, expect, it } from 'vitest';
import {
  DEFAULT_RUN_WINDOW,
  EXAMPLE_TASK,
  hasErrors,
  mapBackendValidationError,
  newIdempotencyKey,
  validateRunForm,
  type RunFormValues,
} from '@/features/runs/validation';

function values(overrides: Partial<RunFormValues> = {}): RunFormValues {
  return {
    task: EXAMPLE_TASK,
    taskType: 'SPEND_ANOMALY_RESEARCH',
    from: DEFAULT_RUN_WINDOW.from,
    to: DEFAULT_RUN_WINDOW.to,
    currency: 'USD',
    notes: '',
    ...overrides,
  };
}

describe('validateRunForm', () => {
  it('accepts a well-formed request', () => {
    const errors = validateRunForm(values());
    expect(hasErrors(errors)).toBe(false);
  });

  it('requires a task description of at least 10 characters', () => {
    expect(validateRunForm(values({ task: '' })).task).toMatch(/describe the research task/i);
    expect(validateRunForm(values({ task: '   ' })).task).toMatch(/describe the research task/i);
    expect(validateRunForm(values({ task: 'too short' })).task).toMatch(/at least 10 characters/i);
    // Whitespace around a valid description must not count against it.
    expect(validateRunForm(values({ task: `   ${EXAMPLE_TASK}   ` })).task).toBeUndefined();
  });

  it('rejects an over-long task description', () => {
    expect(validateRunForm(values({ task: 'x'.repeat(2001) })).task).toMatch(/2000 characters or fewer/i);
  });

  it('validates ISO dates', () => {
    expect(validateRunForm(values({ from: '' })).from).toMatch(/start of the analysis period/i);
    expect(validateRunForm(values({ to: '' })).to).toMatch(/end of the analysis period/i);
    expect(validateRunForm(values({ from: '01/07/2026' })).from).toMatch(/ISO date/i);
    expect(validateRunForm(values({ to: '2026/09/30' })).to).toMatch(/ISO date/i);
  });

  it('rejects a reversed analysis window with the backend’s own wording', () => {
    const errors = validateRunForm(values({ from: '2026-09-30', to: '2026-07-01' }));
    expect(errors.to).toMatch(/from must be on or before to/i);
  });

  it('accepts a single-day window', () => {
    expect(hasErrors(validateRunForm(values({ from: '2026-08-01', to: '2026-08-01' })))).toBe(false);
  });

  it('rejects an unsupported currency', () => {
    expect(validateRunForm(values({ currency: 'EUR' })).currency).toMatch(/Unsupported currency/i);
    expect(validateRunForm(values({ currency: 'usd' })).currency).toBeUndefined();
    expect(validateRunForm(values({ currency: '' })).currency).toMatch(/choose a currency/i);
  });

  it('bounds the optional notes field', () => {
    expect(validateRunForm(values({ notes: 'x'.repeat(1001) })).notes).toMatch(/1000 characters or fewer/i);
  });

  it('reports every offending field at once', () => {
    const errors = validateRunForm({ task: '', taskType: 'SPEND_ANOMALY_RESEARCH', from: '', to: '', currency: 'EUR', notes: '' });
    expect(Object.keys(errors).sort()).toEqual(['currency', 'from', 'task', 'to']);
  });
});

describe('mapBackendValidationError', () => {
  it('places window errors on the end-date field', () => {
    const mapped = mapBackendValidationError('The analysis window is invalid: from must be on or before to.');
    expect(mapped.fieldErrors.to).toBeDefined();
    expect(mapped.formError).toBeNull();
  });

  it('places task and currency errors on their fields', () => {
    expect(mapBackendValidationError('Describe the research task in at least 10 characters.').fieldErrors.task).toBeDefined();
    expect(mapBackendValidationError('Unsupported currency. Supported: USD.').fieldErrors.currency).toBeDefined();
  });

  it('surfaces an unmatched message at form level rather than guessing a field', () => {
    const mapped = mapBackendValidationError('Idempotency-Key must be between 8 and 200 characters.');
    expect(mapped.fieldErrors).toEqual({});
    expect(mapped.formError).toContain('Idempotency-Key');
  });
});

describe('newIdempotencyKey', () => {
  it('generates distinct keys inside the length the backend accepts', () => {
    const keys = new Set(Array.from({ length: 50 }, () => newIdempotencyKey()));
    expect(keys.size).toBe(50);
    for (const key of keys) {
      expect(key.length).toBeGreaterThanOrEqual(8);
      expect(key.length).toBeLessThanOrEqual(200);
    }
  });
});
