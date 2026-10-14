/**
 * Money handling — SRS-POLICY-003.
 *
 * Every monetary value in this system is an INTEGER number of minor units
 * (cents for USD). Floats are never used for money: the only place a decimal
 * representation exists is the presentation boundary (`formatMoney`), and the
 * parser refuses values that cannot be represented exactly.
 */
import { z } from 'zod';

/** Minor units per major unit. The MVP supports 2-decimal currencies only. */
export const MINOR_UNITS_PER_MAJOR = 100;

/**
 * Upper bound for a single financial amount: USD 10,000,000.00.
 * Keeps values safely inside a 32-bit integer column and rejects absurd input.
 */
export const MAX_AMOUNT_MINOR = 1_000_000_000;

/** Currencies accepted by the MVP policy engine. */
export const SUPPORTED_CURRENCIES = ['USD'] as const;
export type SupportedCurrency = (typeof SUPPORTED_CURRENCIES)[number];

export const CurrencySchema = z
  .string()
  .trim()
  .toUpperCase()
  .refine((value): value is SupportedCurrency => (SUPPORTED_CURRENCIES as readonly string[]).includes(value), {
    message: `Unsupported currency. Supported: ${SUPPORTED_CURRENCIES.join(', ')}.`,
  });

/** Integer minor units, positive and bounded. */
export const AmountMinorSchema = z
  .number()
  .int('Amount must be an integer number of minor units (cents).')
  .positive('Amount must be greater than zero.')
  .max(MAX_AMOUNT_MINOR, `Amount must not exceed ${MAX_AMOUNT_MINOR} minor units.`);

export interface Money {
  readonly amountMinor: number;
  readonly currency: SupportedCurrency;
}

export function money(amountMinor: number, currency: string): Money {
  return {
    amountMinor: AmountMinorSchema.parse(amountMinor),
    currency: CurrencySchema.parse(currency),
  };
}

/**
 * Parses a decimal string such as "1234.56" into exact minor units.
 * Rejects values with sub-cent precision instead of silently rounding —
 * rounding money without an explicit policy is how discrepancies are born.
 */
export function parseAmountToMinor(input: string, currency: string = 'USD'): number {
  const value = input.trim();
  const match = /^(-)?(\d{1,12})(?:\.(\d{1,2}))?$/.exec(value);
  if (!match) {
    throw new Error(`Amount "${input}" is not a valid ${currency} decimal value with at most 2 decimals.`);
  }
  const [, sign, whole, fraction = ''] = match;
  if (sign === '-') throw new Error('Amount must be greater than zero.');
  const minor = Number(whole) * MINOR_UNITS_PER_MAJOR + Number(fraction.padEnd(2, '0'));
  return AmountMinorSchema.parse(minor);
}

/** Formats minor units for display only. Never feed the result back into logic. */
export function formatMoney(amountMinor: number, currency: string = 'USD'): string {
  const whole = Math.trunc(amountMinor / MINOR_UNITS_PER_MAJOR);
  const fraction = Math.abs(amountMinor % MINOR_UNITS_PER_MAJOR)
    .toString()
    .padStart(2, '0');
  return `${currency} ${whole}.${fraction}`;
}

export function isSameMoney(a: Money, b: Money): boolean {
  return a.amountMinor === b.amountMinor && a.currency === b.currency;
}

/**
 * Strictly greater-than comparison: the approval threshold is a boundary rule
 * (BUS-RULE-01). Exactly the threshold does NOT trigger approval, so callers
 * must use this helper rather than `>=`.
 */
export function exceedsThreshold(amountMinor: number, thresholdMinor: number): boolean {
  return amountMinor > thresholdMinor;
}

export function assertWithinRefundable(amountMinor: number, refundableMinor: number): void {
  if (amountMinor > refundableMinor) {
    throw new Error(
      `Amount ${formatMoney(amountMinor)} exceeds the refundable balance of ${formatMoney(refundableMinor)}.`,
    );
  }
}
