/**
 * Presentation formatters (FDD §8.3, §8.5).
 *
 * All monetary values arrive from the API as integer minor units and are only
 * ever converted for display, never fed back into logic.
 */

const CURRENCY_FORMATTERS = new Map<string, Intl.NumberFormat>();

function currencyFormatter(currency: string): Intl.NumberFormat | null {
  const cached = CURRENCY_FORMATTERS.get(currency);
  if (cached) return cached;
  try {
    const formatter = new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
    CURRENCY_FORMATTERS.set(currency, formatter);
    return formatter;
  } catch {
    // An unknown currency code must not break a financial screen; fall back to a
    // plain decimal rendering below.
    return null;
  }
}

/**
 * Formats integer minor units as a currency amount, e.g. `245000` → `$2,450.00`.
 * Negative zero and unknown currencies are handled explicitly.
 */
export function formatMoney(amountMinor: number, currency = 'USD'): string {
  if (!Number.isFinite(amountMinor)) return '—';
  const formatter = currencyFormatter(currency);
  const major = amountMinor / 100;
  if (formatter) return formatter.format(major);
  return `${currency} ${major.toFixed(2)}`;
}

/** Formats minor units without a currency symbol, e.g. `245000` → `2,450.00`. */
export function formatAmount(amountMinor: number): string {
  if (!Number.isFinite(amountMinor)) return '—';
  return (amountMinor / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Integer with thousands separators. */
export function formatNumber(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return value.toLocaleString('en-US');
}

const DATE_TIME = new Intl.DateTimeFormat('en-GB', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

const DATE_ONLY = new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
const TIME_ONLY = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });

function toDate(value: string | Date | null | undefined): Date | null {
  if (value === null || value === undefined) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatDateTime(value: string | Date | null | undefined): string {
  const date = toDate(value);
  return date ? DATE_TIME.format(date) : '—';
}

export function formatDate(value: string | Date | null | undefined): string {
  const date = toDate(value);
  return date ? DATE_ONLY.format(date) : '—';
}

export function formatTime(value: string | Date | null | undefined): string {
  const date = toDate(value);
  return date ? TIME_ONLY.format(date) : '—';
}

/** ISO timestamp for copy/paste and diagnostics. */
export function formatIso(value: string | Date | null | undefined): string {
  const date = toDate(value);
  return date ? date.toISOString() : '—';
}

const RELATIVE_UNITS: Array<{ limitMs: number; divisor: number; unit: Intl.RelativeTimeFormatUnit }> = [
  { limitMs: 60_000, divisor: 1_000, unit: 'second' },
  { limitMs: 3_600_000, divisor: 60_000, unit: 'minute' },
  { limitMs: 86_400_000, divisor: 3_600_000, unit: 'hour' },
  { limitMs: 2_592_000_000, divisor: 86_400_000, unit: 'day' },
  { limitMs: 31_536_000_000, divisor: 2_592_000_000, unit: 'month' },
];

/**
 * "3 minutes ago" / "in 42 minutes". `now` is injectable so the behaviour is
 * deterministic under test.
 */
export function formatRelativeTime(value: string | Date | null | undefined, now: Date = new Date()): string {
  const date = toDate(value);
  if (!date) return '—';
  const formatter = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
  const deltaMs = date.getTime() - now.getTime();
  const magnitude = Math.abs(deltaMs);
  for (const { limitMs, divisor, unit } of RELATIVE_UNITS) {
    if (magnitude < limitMs) return formatter.format(Math.round(deltaMs / divisor), unit);
  }
  return formatter.format(Math.round(deltaMs / 31_536_000_000), 'year');
}

/** Compact duration for timeline steps: `340 ms`, `1.2 s`, `2 m 05 s`. */
export function formatDurationMs(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms) || ms < 0) return '—';
  if (ms < 1_000) return `${Math.round(ms)} ms`;
  if (ms < 60_000) return `${(ms / 1_000).toFixed(1)} s`;
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.round((ms % 60_000) / 1_000);
  return `${minutes} m ${seconds.toString().padStart(2, '0')} s`;
}

/** Elapsed time between two timestamps; `null` end means "still running". */
export function formatDurationBetween(start: string | null | undefined, end: string | null | undefined): string {
  const from = toDate(start);
  if (!from) return '—';
  const to = toDate(end) ?? new Date();
  return formatDurationMs(to.getTime() - from.getTime());
}

/** Time remaining until a deadline, for approval expiry warnings. */
export function formatCountdown(deadline: string | null | undefined, now: Date = new Date()): string {
  const date = toDate(deadline);
  if (!date) return '—';
  const delta = date.getTime() - now.getTime();
  if (delta <= 0) return 'expired';
  if (delta < 60_000) return `${Math.ceil(delta / 1_000)} s`;
  if (delta < 3_600_000) return `${Math.floor(delta / 60_000)} min`;
  if (delta < 86_400_000) return `${Math.floor(delta / 3_600_000)} h`;
  return `${Math.floor(delta / 86_400_000)} d`;
}

/** Short identifier for dense tables: `38b4e0e4…` → `38b4e0e4`. */
export function shortId(id: string | null | undefined, length = 8): string {
  if (!id) return '—';
  return id.length <= length ? id : id.slice(0, length);
}

/**
 * First 8 characters of a UUID, which is what operators quote to each other.
 * Distinct from `shortId` only in intent, and kept so the call sites read well.
 */
export function formatRunId(id: string | null | undefined): string {
  return shortId(id, 8);
}

/** `REQUIRES_HUMAN_APPROVAL` → `Requires human approval`. */
export function humanizeEnum(value: string | null | undefined): string {
  if (!value) return '—';
  const words = value.replace(/[_-]+/g, ' ').toLowerCase().trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** `RUN-1042` style reference used in page headers (FDD §7.4). */
export function formatRunReference(runId: string): string {
  return `RUN-${formatRunId(runId).toUpperCase()}`;
}

/** Percentage from a ratio, e.g. `0.512 → '51.2%'`. */
export function formatRatioPercent(ratio: number, digits = 1): string {
  if (!Number.isFinite(ratio)) return '—';
  return `${(ratio * 100).toFixed(digits)}%`;
}

/** Renders an arbitrary evidence value for a definition list. */
export function formatEvidenceValue(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return formatNumber(value);
  if (typeof value === 'boolean') return value ? 'yes' : 'no';
  if (Array.isArray(value)) return value.map((item) => formatEvidenceValue(item)).join(', ');
  return JSON.stringify(value);
}
