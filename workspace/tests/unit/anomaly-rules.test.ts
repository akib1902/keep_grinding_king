/**
 * Deterministic anomaly rules — PR-04, SRS-RESEARCH-003..006.
 *
 * Two properties are asserted beyond "the rules fire": reproducibility (same
 * dataset ⇒ identical findings, including stable ids) and restraint (only rules
 * with an arithmetic overcharge basis are marked refund eligible).
 */
import { describe, expect, it } from 'vitest';
import {
  ANOMALY_CONFIG_V1,
  AnomalyRuleId,
  detectAnomalies,
  median,
  type AnalysisTransaction,
} from '../../src/domain/anomaly.js';

let counter = 0;
function tx(overrides: Partial<AnalysisTransaction> = {}): AnalysisTransaction {
  counter += 1;
  return {
    id: `tx-${counter}`,
    supplierId: 'sup-1',
    supplierName: 'Supplier One',
    amountMinor: 10_000,
    currency: 'USD',
    occurredAt: '2026-08-01T00:00:00.000Z',
    invoiceRef: null,
    category: 'OFFICE',
    description: 'Ordinary purchase',
    status: 'POSTED',
    ...overrides,
  };
}

const WINDOW = { from: '2026-07-01', to: '2026-09-30' };

describe('median', () => {
  it('returns zero for an empty set and the lower middle for even counts', () => {
    expect(median([])).toBe(0);
    expect(median([5])).toBe(5);
    expect(median([1, 2, 3, 4])).toBe(2);
    expect(median([10, 2, 8])).toBe(8);
  });
});

describe('reproducibility', () => {
  it('produces identical findings for the same dataset and rule version', () => {
    const dataset: AnalysisTransaction[] = [
      tx({ amountMinor: 1_000 }),
      tx({ amountMinor: 2_000 }),
      tx({ amountMinor: 20_000, supplierId: 'sup-2' }),
      tx({ amountMinor: 20_000, supplierId: 'sup-2', occurredAt: '2026-08-02T00:00:00.000Z' }),
    ];
    const first = detectAnomalies(dataset, WINDOW);
    const second = detectAnomalies(dataset, WINDOW);
    expect(second).toEqual(first);
    expect(second.findings.map((finding) => finding.id)).toEqual(first.findings.map((finding) => finding.id));
  });

  it('ignores transactions outside the window', () => {
    const analysis = detectAnomalies([tx({ occurredAt: '2026-01-05T00:00:00.000Z' }), tx()], WINDOW);
    expect(analysis.transactionCount).toBe(1);
  });

  it('ignores refunded transactions', () => {
    const analysis = detectAnomalies([tx({ status: 'REFUNDED' }), tx(), tx()], WINDOW);
    expect(analysis.transactionCount).toBe(2);
  });
});

describe('ANOM-001 duplicate invoice reference', () => {
  it('flags the repeated invoice and computes the overcharge', () => {
    const analysis = detectAnomalies(
      [
        tx({ invoiceRef: 'INV-1', amountMinor: 245_000 }),
        tx({ invoiceRef: 'INV-1', amountMinor: 245_000, occurredAt: '2026-08-20T00:00:00.000Z' }),
      ],
      WINDOW,
    );
    const finding = analysis.findings.find((candidate) => candidate.ruleId === AnomalyRuleId.DUPLICATE_INVOICE_REFERENCE);
    expect(finding).toBeDefined();
    expect(finding?.severity).toBe('HIGH');
    expect(finding?.evidence.transactionIds).toHaveLength(2);
    expect(finding?.evidence.metrics.duplicateMinor).toBe(245_000);
    expect(finding?.refundEligible).toBe(true);
    expect(finding?.suggestedRefundMinor).toBe(245_000);
  });

  it('does not flag unique invoice references', () => {
    const analysis = detectAnomalies([tx({ invoiceRef: 'INV-1' }), tx({ invoiceRef: 'INV-2' })], WINDOW);
    expect(analysis.findings.filter((finding) => finding.ruleId === AnomalyRuleId.DUPLICATE_INVOICE_REFERENCE)).toHaveLength(0);
  });

  it('treats the same invoice reference from different suppliers separately', () => {
    const analysis = detectAnomalies([tx({ invoiceRef: 'INV-1' }), tx({ invoiceRef: 'INV-1', supplierId: 'sup-2' })], WINDOW);
    expect(analysis.findings.filter((finding) => finding.ruleId === AnomalyRuleId.DUPLICATE_INVOICE_REFERENCE)).toHaveLength(0);
  });
});

describe('ANOM-002 repeated charge', () => {
  it('flags three identical charges within the window and computes the overcharge', () => {
    const analysis = detectAnomalies(
      [
        tx({ amountMinor: 187_500, occurredAt: '2026-08-03T00:00:00.000Z' }),
        tx({ amountMinor: 187_500, occurredAt: '2026-08-05T00:00:00.000Z' }),
        tx({ amountMinor: 187_500, occurredAt: '2026-08-07T00:00:00.000Z' }),
      ],
      WINDOW,
    );
    const finding = analysis.findings.find((candidate) => candidate.ruleId === AnomalyRuleId.REPEATED_CHARGE);
    expect(finding?.evidence.transactionIds).toHaveLength(3);
    expect(finding?.suggestedRefundMinor).toBe(375_000);
    expect(finding?.refundEligible).toBe(true);
    expect(finding?.severity).toBe('HIGH');
  });

  it('does not group identical charges separated by more than the configured window', () => {
    const analysis = detectAnomalies(
      [
        tx({ amountMinor: 187_500, occurredAt: '2026-08-03T00:00:00.000Z' }),
        tx({ amountMinor: 187_500, occurredAt: '2026-09-03T00:00:00.000Z' }),
      ],
      WINDOW,
    );
    expect(analysis.findings.filter((finding) => finding.ruleId === AnomalyRuleId.REPEATED_CHARGE)).toHaveLength(0);
  });

  it('ignores repeated charges below the noise floor', () => {
    const analysis = detectAnomalies(
      [
        tx({ amountMinor: 500, occurredAt: '2026-08-03T00:00:00.000Z' }),
        tx({ amountMinor: 500, occurredAt: '2026-08-04T00:00:00.000Z' }),
      ],
      WINDOW,
    );
    const finding = analysis.findings.find((candidate) => candidate.ruleId === AnomalyRuleId.REPEATED_CHARGE);
    expect(finding).toBeDefined();
    expect(finding?.refundEligible).toBe(false);
  });
});

describe('ANOM-003 outsized transaction is suspicious but not refund eligible', () => {
  it('flags a transaction far above the median without proposing a refund', () => {
    const dataset: AnalysisTransaction[] = [
      tx({ amountMinor: 50_000 }),
      tx({ amountMinor: 50_000 }),
      tx({ amountMinor: 1_450_000, supplierId: 'sup-3' }),
    ];
    const analysis = detectAnomalies(dataset, WINDOW);
    const finding = analysis.findings.find((candidate) => candidate.ruleId === AnomalyRuleId.OUTSIZED_TRANSACTION);
    expect(finding).toBeDefined();
    expect(finding?.severity).toBe('LOW');
    expect(finding?.refundEligible).toBe(false);
    expect(finding?.suggestedRefundMinor).toBe(0);
  });
});

describe('ANOM-004 spend deviation against the comparison period', () => {
  it('flags a category whose spend more than doubles', () => {
    const dataset: AnalysisTransaction[] = [
      // Comparable preceding window (Q2) with 50,000 minor units of OFFICE spend.
      tx({ amountMinor: 50_000, occurredAt: '2026-06-01T00:00:00.000Z', category: 'OFFICE' }),
      // Analysis window with 250,000 minor units of OFFICE spend.
      tx({ amountMinor: 250_000, occurredAt: '2026-08-01T00:00:00.000Z', category: 'OFFICE' }),
    ];
    const analysis = detectAnomalies(dataset, WINDOW);
    const finding = analysis.findings.find((candidate) => candidate.ruleId === AnomalyRuleId.SPEND_DEVIATION);
    expect(finding).toBeDefined();
    expect(finding?.evidence.metrics.category).toBe('OFFICE');
    expect(finding?.evidence.metrics.ratio).toBeGreaterThanOrEqual(ANOMALY_CONFIG_V1.deviationMultiplier);
    expect(finding?.refundEligible).toBe(false);
  });

  it('does not flag a stable category', () => {
    const dataset: AnalysisTransaction[] = [
      tx({ amountMinor: 50_000, occurredAt: '2026-06-01T00:00:00.000Z' }),
      tx({ amountMinor: 55_000, occurredAt: '2026-08-01T00:00:00.000Z' }),
    ];
    const analysis = detectAnomalies(dataset, WINDOW);
    expect(analysis.findings.filter((finding) => finding.ruleId === AnomalyRuleId.SPEND_DEVIATION)).toHaveLength(0);
  });
});

describe('ANOM-005 supplier concentration', () => {
  it('flags a supplier holding most of the window spend', () => {
    const dataset: AnalysisTransaction[] = [
      tx({ amountMinor: 900_000, supplierId: 'sup-big' }),
      tx({ amountMinor: 100_000, supplierId: 'sup-small' }),
    ];
    const analysis = detectAnomalies(dataset, WINDOW);
    const finding = analysis.findings.find((candidate) => candidate.ruleId === AnomalyRuleId.SUPPLIER_CONCENTRATION);
    expect(finding?.evidence.metrics.share).toBeCloseTo(0.9, 4);
    expect(finding?.refundEligible).toBe(false);
  });
});

describe('report shape', () => {
  it('sorts findings by severity so the most material come first', () => {
    const dataset: AnalysisTransaction[] = [
      tx({ invoiceRef: 'INV-1', amountMinor: 245_000 }),
      tx({ invoiceRef: 'INV-1', amountMinor: 245_000, occurredAt: '2026-08-10T00:00:00.000Z' }),
      tx({ amountMinor: 5_000, supplierId: 'sup-2' }),
      tx({ amountMinor: 1_000_000, supplierId: 'sup-3' }),
    ];
    const analysis = detectAnomalies(dataset, WINDOW);
    const severities = analysis.findings.map((finding) => finding.severity);
    const rank = { HIGH: 0, MEDIUM: 1, LOW: 2 } as const;
    const ranks = severities.map((severity) => rank[severity]);
    expect([...ranks].sort((a, b) => a - b)).toEqual(ranks);
  });

  it('reports the rule version and window it analysed', () => {
    const analysis = detectAnomalies([tx()], WINDOW);
    expect(analysis.ruleVersion).toBe(ANOMALY_CONFIG_V1.version);
    expect(analysis.window).toEqual(WINDOW);
    expect(analysis.currency).toBe('USD');
  });
});
