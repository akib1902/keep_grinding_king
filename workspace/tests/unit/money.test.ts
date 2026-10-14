/**
 * Money invariants — SRS-POLICY-003 and the approval boundary (BUS-RULE-01).
 *
 * These cases exist because "close enough" arithmetic on money is how off-by-one
 * refunds reach a ledger.
 */
import { describe, expect, it } from 'vitest';
import {
  AmountMinorSchema,
  MAX_AMOUNT_MINOR,
  MINOR_UNITS_PER_MAJOR,
  exceedsThreshold,
  formatMoney,
  money,
  parseAmountToMinor,
} from '../../src/domain/money.js';

describe('money: exact minor units', () => {
  it('uses 100 minor units per major unit', () => {
    expect(MINOR_UNITS_PER_MAJOR).toBe(100);
  });

  it('parses decimal strings exactly', () => {
    expect(parseAmountToMinor('500.00')).toBe(50_000);
    expect(parseAmountToMinor('500')).toBe(50_000);
    expect(parseAmountToMinor('0.01')).toBe(1);
    expect(parseAmountToMinor('1234.5')).toBe(123_450);
    expect(parseAmountToMinor('1234.56')).toBe(123_456);
  });

  it('rejects sub-cent precision instead of rounding it away', () => {
    expect(() => parseAmountToMinor('10.001')).toThrow(/at most 2 decimals/);
    expect(() => parseAmountToMinor('10.999')).toThrow(/at most 2 decimals/);
  });

  it('rejects negative and malformed amounts', () => {
    expect(() => parseAmountToMinor('-1.00')).toThrow(/greater than zero/);
    expect(() => parseAmountToMinor('abc')).toThrow(/not a valid/);
    expect(() => parseAmountToMinor('')).toThrow(/not a valid/);
  });

  it('formats back to a two-decimal representation', () => {
    expect(formatMoney(50_000)).toBe('USD 500.00');
    expect(formatMoney(1)).toBe('USD 0.01');
    expect(formatMoney(123_456)).toBe('USD 1234.56');
    expect(formatMoney(0)).toBe('USD 0.00');
  });

  it('round-trips through parse and format', () => {
    for (const value of ['0.01', '1.00', '500.00', '9999.99', '500000.00']) {
      expect(formatMoney(parseAmountToMinor(value)).endsWith(value)).toBe(true);
    }
  });

  it('rejects non-integer, zero and out-of-range amounts at the schema boundary', () => {
    expect(AmountMinorSchema.safeParse(10.5).success).toBe(false);
    expect(AmountMinorSchema.safeParse(0).success).toBe(false);
    expect(AmountMinorSchema.safeParse(-5).success).toBe(false);
    expect(AmountMinorSchema.safeParse(MAX_AMOUNT_MINOR + 1).success).toBe(false);
    expect(AmountMinorSchema.safeParse(MAX_AMOUNT_MINOR).success).toBe(true);
  });

  it('constructs typed money values and rejects unsupported currencies elsewhere', () => {
    const value = money(50_000, 'usd');
    expect(value.amountMinor).toBe(50_000);
    expect(value.currency).toBe('USD');
  });
});

describe('money: approval threshold is a strict boundary', () => {
  const threshold = 50_000;

  it('treats exactly the threshold as below it (BUS-RULE-01)', () => {
    expect(exceedsThreshold(threshold, threshold)).toBe(false);
  });

  it('treats one minor unit above the threshold as exceeding it', () => {
    expect(exceedsThreshold(threshold + 1, threshold)).toBe(true);
  });

  it('treats a smaller amount as below the threshold', () => {
    expect(exceedsThreshold(threshold - 1, threshold)).toBe(false);
  });
});
