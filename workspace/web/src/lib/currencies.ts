/**
 * Currencies the MVP policy engine accepts (mirrors `SUPPORTED_CURRENCIES` in the
 * backend's `src/domain/money.ts`). The list is duplicated deliberately so the
 * form can constrain input without a round trip; the backend still rejects
 * anything it does not support.
 */
export const SUPPORTED_CURRENCIES: readonly string[] = ['USD'];

export const DEFAULT_CURRENCY = 'USD';

export const TASK_TYPES = [
  { value: 'SPEND_ANOMALY_RESEARCH', label: 'Spend anomaly research' },
  { value: 'SUPPLIER_DISCREPANCY_REVIEW', label: 'Supplier discrepancy review' },
] as const;
