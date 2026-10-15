import { describe, expect, it } from 'vitest';
import {
  formatCountdown,
  formatDurationBetween,
  formatDurationMs,
  formatEvidenceValue,
  formatMoney,
  formatNumber,
  formatRatioPercent,
  formatRelativeTime,
  formatRunId,
  formatRunReference,
  humanizeEnum,
  shortId,
} from '@/lib/formatters';

describe('formatMoney', () => {
  it('renders integer minor units as a currency amount', () => {
    expect(formatMoney(245000)).toBe('$2,450.00');
    expect(formatMoney(75000)).toBe('$750.00');
    expect(formatMoney(0)).toBe('$0.00');
    expect(formatMoney(5)).toBe('$0.05');
    expect(formatMoney(123456789)).toBe('$1,234,567.89');
  });

  it('never rounds to a different cent value', () => {
    // Money is exact: the formatted string must round-trip to the same minor units.
    const cases = [1, 7, 99, 100, 101, 99999, 100000001];
    for (const minor of cases) {
      const rendered = formatMoney(minor).replace(/[$,]/g, '');
      expect(Math.round(Number(rendered) * 100)).toBe(minor);
    }
  });

  it('renders a valid but unusual currency code through Intl', () => {
    // Intl accepts any well-formed ISO 4217 code, so the console does not
    // special-case the currencies the MVP policy supports.
    expect(formatMoney(1234, 'ZMW')).toContain('12.34');
  });

  it('falls back to a plain decimal rendering when Intl rejects the code', () => {
    expect(formatMoney(1234, 'ZZ')).toBe('ZZ 12.34');
  });

  it('renders non-finite input as an explicit placeholder', () => {
    expect(formatMoney(Number.NaN)).toBe('—');
  });

  it('renders negative amounts without losing the sign', () => {
    expect(formatMoney(-5000)).toBe('-$50.00');
  });
});

describe('formatNumber', () => {
  it('groups thousands and handles missing values', () => {
    expect(formatNumber(1248)).toBe('1,248');
    expect(formatNumber(0)).toBe('0');
    expect(formatNumber(null)).toBe('—');
    expect(formatNumber(undefined)).toBe('—');
  });
});

describe('formatDurationMs', () => {
  it('uses a readable unit per magnitude', () => {
    expect(formatDurationMs(340)).toBe('340 ms');
    expect(formatDurationMs(1250)).toBe('1.3 s');
    expect(formatDurationMs(125000)).toBe('2 m 05 s');
  });

  it('rejects nonsense durations rather than displaying them', () => {
    expect(formatDurationMs(null)).toBe('—');
    expect(formatDurationMs(-1)).toBe('—');
    expect(formatDurationMs(Number.POSITIVE_INFINITY)).toBe('—');
  });
});

describe('formatDurationBetween', () => {
  it('measures a completed window', () => {
    expect(formatDurationBetween('2026-08-01T09:00:00.000Z', '2026-08-01T09:00:02.500Z')).toBe('2.5 s');
  });

  it('treats a missing end as still running', () => {
    const start = new Date(Date.now() - 3000).toISOString();
    expect(formatDurationBetween(start, null)).toMatch(/^[23](\.\d)? s$/);
  });

  it('reports an unknown start as unavailable', () => {
    expect(formatDurationBetween(null, null)).toBe('—');
  });
});

describe('formatCountdown', () => {
  const now = new Date('2026-08-01T10:00:00.000Z');

  it('describes remaining time at each scale', () => {
    expect(formatCountdown('2026-08-01T10:00:30.000Z', now)).toBe('30 s');
    expect(formatCountdown('2026-08-01T10:42:00.000Z', now)).toBe('42 min');
    expect(formatCountdown('2026-08-01T14:00:00.000Z', now)).toBe('4 h');
    expect(formatCountdown('2026-08-04T10:00:00.000Z', now)).toBe('3 d');
  });

  it('marks a past deadline as expired rather than negative', () => {
    expect(formatCountdown('2026-08-01T09:59:59.000Z', now)).toBe('expired');
  });
});

describe('formatRelativeTime', () => {
  const now = new Date('2026-08-01T12:00:00.000Z');

  it('formats past and future timestamps', () => {
    expect(formatRelativeTime('2026-08-01T11:57:00.000Z', now)).toBe('3 minutes ago');
    expect(formatRelativeTime('2026-08-01T12:30:00.000Z', now)).toBe('in 30 minutes');
  });

  it('handles a missing timestamp', () => {
    expect(formatRelativeTime(null, now)).toBe('—');
  });
});

describe('identifiers', () => {
  it('shortens ids and preserves short ones', () => {
    expect(shortId('38b4e0e4-7ef5-4dba-922e-9e5c5593a946')).toBe('38b4e0e4');
    expect(shortId('abc')).toBe('abc');
    expect(shortId(null)).toBe('—');
  });

  it('builds the RUN- reference shown in page headers', () => {
    expect(formatRunId('38b4e0e4-7ef5-4dba-922e-9e5c5593a946')).toBe('38b4e0e4');
    expect(formatRunReference('38b4e0e4-7ef5-4dba-922e-9e5c5593a946')).toBe('RUN-38B4E0E4');
  });
});

describe('humanizeEnum', () => {
  it('turns domain enums into readable labels', () => {
    expect(humanizeEnum('REQUIRES_HUMAN_APPROVAL')).toBe('Requires human approval');
    expect(humanizeEnum('HIGH')).toBe('High');
    expect(humanizeEnum(null)).toBe('—');
  });
});

describe('formatRatioPercent', () => {
  it('renders a ratio as a percentage', () => {
    expect(formatRatioPercent(0.512)).toBe('51.2%');
    expect(formatRatioPercent(1, 0)).toBe('100%');
  });
});

describe('formatEvidenceValue', () => {
  it('renders each evidence value type without throwing', () => {
    expect(formatEvidenceValue('INV-2026-7100')).toBe('INV-2026-7100');
    expect(formatEvidenceValue(245000)).toBe('245,000');
    expect(formatEvidenceValue(true)).toBe('yes');
    expect(formatEvidenceValue(['a', 'b'])).toBe('a, b');
    expect(formatEvidenceValue(null)).toBe('—');
    expect(formatEvidenceValue({ a: 1 })).toBe('{"a":1}');
  });
});
