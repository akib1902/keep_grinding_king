/**
 * Deterministic anomaly detection — PR-04, SRS-RESEARCH-003..006.
 *
 * These rules are the reproducible backbone of the research report. They are
 * pure functions of (dataset, config): the same inputs always yield the same
 * findings, which is what lets a reviewer re-run the analysis and get the same
 * answer. The model may add interpretation, but it cannot invent the facts.
 *
 * Two guardrails shape the output:
 *  * A finding is a *description of evidence*, never a fraud verdict
 *    (SRS-RESEARCH-005): the model's narrative is attached separately and
 *    labelled as interpretation.
 *  * Only rules with an arithmetically defensible overcharge basis are marked
 *    `refundEligible`. A "large transaction" is suspicious, not refundable.
 */
import { sha256 } from './ids.js';

export const AnomalyRuleId = {
  DUPLICATE_INVOICE_REFERENCE: 'ANOM-001',
  REPEATED_CHARGE: 'ANOM-002',
  OUTSIZED_TRANSACTION: 'ANOM-003',
  SPEND_DEVIATION: 'ANOM-004',
  SUPPLIER_CONCENTRATION: 'ANOM-005',
} as const;

export type AnomalySeverity = 'LOW' | 'MEDIUM' | 'HIGH';

export interface AnomalyConfig {
  readonly version: string;
  /** Repeated identical charges within this many days are grouped. */
  readonly repeatedChargeWindowDays: number;
  /** A transaction is outsized at or above this multiple of the median. */
  readonly outsizedMultiplier: number;
  /** Window total must be at least this multiple of the baseline to flag deviation. */
  readonly deviationMultiplier: number;
  /** Share of total spend that a single supplier may hold before being flagged. */
  readonly concentrationShare: number;
  /** Outliers below this amount are ignored as noise. */
  readonly noiseFloorMinor: number;
}

export const ANOMALY_CONFIG_V1: AnomalyConfig = Object.freeze({
  version: 'v1',
  repeatedChargeWindowDays: 7,
  outsizedMultiplier: 3,
  deviationMultiplier: 2.5,
  concentrationShare: 0.5,
  noiseFloorMinor: 10_000, // USD 100.00
});

export interface AnalysisTransaction {
  id: string;
  supplierId: string;
  supplierName: string;
  amountMinor: number;
  currency: string;
  occurredAt: string;
  invoiceRef: string | null;
  category: string;
  description: string;
  status: string;
}

export interface AnalysisWindow {
  from: string;
  to: string;
}

export interface AnomalyFinding {
  /** Stable id: rule + participating records, so a re-run produces the same id. */
  id: string;
  ruleId: string;
  ruleVersion: string;
  severity: AnomalySeverity;
  title: string;
  /** Deterministic, template-rendered statement of what the data shows. */
  observations: string[];
  /** Transaction ids the finding is based on — the evidence references. */
  evidence: {
    transactionIds: string[];
    supplierIds: string[];
    metrics: Record<string, number | string>;
  };
  /** Whether the evidence supports a refund proposal, and for how much. */
  refundEligible: boolean;
  suggestedRefundMinor: number;
}

export interface AnomalyAnalysis {
  ruleVersion: string;
  window: AnalysisWindow;
  transactionCount: number;
  totalSpendMinor: number;
  currency: string;
  baselineMedianMinor: number;
  findings: AnomalyFinding[];
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Lower-middle median over integers — no interpolation, fully reproducible. */
export function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor((sorted.length - 1) / 2);
  return sorted[middle] as number;
}

function parseTime(value: string): number {
  const time = Date.parse(value);
  if (Number.isNaN(time)) throw new Error(`Invalid timestamp in analysis input: ${value}`);
  return time;
}

function toDays(ms: number): number {
  return ms / DAY_MS;
}

export function detectAnomalies(
  transactions: readonly AnalysisTransaction[],
  window: AnalysisWindow,
  config: AnomalyConfig = ANOMALY_CONFIG_V1,
): AnomalyAnalysis {
  const inWindow = transactions
    .filter((tx) => tx.occurredAt >= window.from && tx.occurredAt <= window.to && tx.status !== 'REFUNDED')
    .sort((a, b) => (a.occurredAt < b.occurredAt ? -1 : a.occurredAt > b.occurredAt ? 1 : a.id < b.id ? -1 : 1));

  const currency = inWindow[0]?.currency ?? 'USD';
  const totalSpendMinor = inWindow.reduce((sum, tx) => sum + tx.amountMinor, 0);
  const baselineMedianMinor = median(inWindow.map((tx) => tx.amountMinor));

  const findings: AnomalyFinding[] = [
    ...duplicateInvoiceFindings(inWindow, config),
    ...repeatedChargeFindings(inWindow, config),
    ...outsizedTransactionFindings(inWindow, config, baselineMedianMinor),
    ...spendDeviationFindings(transactions, window, config),
    ...supplierConcentrationFindings(inWindow, config, totalSpendMinor),
  ];

  const severityRank: Record<AnomalySeverity, number> = { HIGH: 0, MEDIUM: 1, LOW: 2 };
  findings.sort((a, b) => severityRank[a.severity] - severityRank[b.severity] || (a.id < b.id ? -1 : 1));

  return {
    ruleVersion: config.version,
    window,
    transactionCount: inWindow.length,
    totalSpendMinor,
    currency,
    baselineMedianMinor,
    findings,
  };
}

// ---------------------------------------------------------------------------
// ANOM-001 — same invoice reference charged more than once
// ---------------------------------------------------------------------------

function duplicateInvoiceFindings(txs: readonly AnalysisTransaction[], config: AnomalyConfig): AnomalyFinding[] {
  const groups = new Map<string, AnalysisTransaction[]>();
  for (const tx of txs) {
    if (!tx.invoiceRef || tx.status !== 'POSTED') continue;
    const key = `${tx.supplierId}::${tx.invoiceRef}`;
    const bucket = groups.get(key);
    if (bucket) bucket.push(tx);
    else groups.set(key, [tx]);
  }

  const findings: AnomalyFinding[] = [];
  for (const [key, group] of [...groups.entries()].sort(([a], [b]) => (a < b ? -1 : 1))) {
    if (group.length < 2) continue;
    const chargedMinor = group.reduce((sum, tx) => sum + tx.amountMinor, 0);
    // The earliest charge is treated as legitimate; the rest are the overcharge.
    const first = group[0] as AnalysisTransaction;
    const duplicateMinor = chargedMinor - first.amountMinor;
    findings.push({
      id: `${AnomalyRuleId.DUPLICATE_INVOICE_REFERENCE}:${sha256(key).slice(0, 16)}`,
      ruleId: AnomalyRuleId.DUPLICATE_INVOICE_REFERENCE,
      ruleVersion: config.version,
      severity: 'HIGH',
      title: 'Duplicate invoice reference',
      observations: [
        `Invoice ${first.invoiceRef} from ${first.supplierName} appears ${group.length} times within the analysed period.`,
        `Combined charge ${formatMinor(chargedMinor, first.currency)}; the earliest charge is ${formatMinor(first.amountMinor, first.currency)}.`,
        `Difference of ${formatMinor(duplicateMinor, first.currency)} is the portion not explained by a single invoice.`,
      ],
      evidence: {
        transactionIds: group.map((tx) => tx.id),
        supplierIds: [...new Set(group.map((tx) => tx.supplierId))],
        metrics: {
          occurrences: group.length,
          invoiceRef: first.invoiceRef ?? '',
          chargedMinor,
          duplicateMinor,
        },
      },
      refundEligible: duplicateMinor > 0 && duplicateMinor >= config.noiseFloorMinor,
      suggestedRefundMinor: duplicateMinor,
    });
  }
  return findings;
}

// ---------------------------------------------------------------------------
// ANOM-002 — the same supplier charging the same amount in quick succession
// ---------------------------------------------------------------------------

function repeatedChargeFindings(txs: readonly AnalysisTransaction[], config: AnomalyConfig): AnomalyFinding[] {
  const groups = new Map<string, AnalysisTransaction[]>();
  for (const tx of txs) {
    if (tx.status !== 'POSTED') continue;
    const key = `${tx.supplierId}::${tx.amountMinor}`;
    const bucket = groups.get(key);
    if (bucket) bucket.push(tx);
    else groups.set(key, [tx]);
  }

  const findings: AnomalyFinding[] = [];
  for (const [key, group] of [...groups.entries()].sort(([a], [b]) => (a < b ? -1 : 1))) {
    if (group.length < 2) continue;
    const sorted = [...group].sort((a, b) => parseTime(a.occurredAt) - parseTime(b.occurredAt));
    // Consecutive runs within the window; keep the widest run for a stable report.
    let run: AnalysisTransaction[] = [sorted[0] as AnalysisTransaction];
    let best: AnalysisTransaction[] = [];
    for (let i = 1; i < sorted.length; i += 1) {
      const previous = sorted[i - 1] as AnalysisTransaction;
      const current = sorted[i] as AnalysisTransaction;
      const gapDays = toDays(parseTime(current.occurredAt) - parseTime(previous.occurredAt));
      if (gapDays <= config.repeatedChargeWindowDays) run.push(current);
      else {
        if (run.length > best.length) best = run;
        run = [current];
      }
    }
    if (run.length > best.length) best = run;
    if (best.length < 2) continue;

    const first = best[0] as AnalysisTransaction;
    const overchargeMinor = first.amountMinor * (best.length - 1);
    findings.push({
      id: `${AnomalyRuleId.REPEATED_CHARGE}:${sha256(key).slice(0, 16)}`,
      ruleId: AnomalyRuleId.REPEATED_CHARGE,
      ruleVersion: config.version,
      severity: best.length > 2 ? 'HIGH' : 'MEDIUM',
      title: 'Repeated identical charge',
      observations: [
        `${first.supplierName} charged ${formatMinor(first.amountMinor, first.currency)} ${best.length} times within ${config.repeatedChargeWindowDays} days.`,
        `Spread from ${(best[0] as AnalysisTransaction).occurredAt} to ${(best[best.length - 1] as AnalysisTransaction).occurredAt}.`,
        `Amount beyond the first charge: ${formatMinor(overchargeMinor, first.currency)}.`,
      ],
      evidence: {
        transactionIds: best.map((tx) => tx.id),
        supplierIds: [first.supplierId],
        metrics: { occurrences: best.length, unitAmountMinor: first.amountMinor, overchargeMinor },
      },
      refundEligible: overchargeMinor >= config.noiseFloorMinor,
      suggestedRefundMinor: overchargeMinor,
    });
  }
  return findings;
}

// ---------------------------------------------------------------------------
// ANOM-003 — a transaction far above the period median
// ---------------------------------------------------------------------------

function outsizedTransactionFindings(
  txs: readonly AnalysisTransaction[],
  config: AnomalyConfig,
  baselineMedianMinor: number,
): AnomalyFinding[] {
  if (baselineMedianMinor <= 0) return [];
  return txs
    .filter((tx) => tx.amountMinor >= baselineMedianMinor * config.outsizedMultiplier && tx.amountMinor >= config.noiseFloorMinor)
    .map((tx) => ({
      id: `${AnomalyRuleId.OUTSIZED_TRANSACTION}:${sha256(`${tx.id}:${tx.amountMinor}`).slice(0, 16)}`,
      ruleId: AnomalyRuleId.OUTSIZED_TRANSACTION,
      ruleVersion: config.version,
      severity: 'LOW' as AnomalySeverity,
      title: 'Transaction far above the period median',
      observations: [
        `${tx.supplierName} charged ${formatMinor(tx.amountMinor, tx.currency)} on ${tx.occurredAt}.`,
        `That is ${(tx.amountMinor / baselineMedianMinor).toFixed(2)}x the median transaction of ${formatMinor(baselineMedianMinor, tx.currency)} for this period.`,
      ],
      evidence: {
        transactionIds: [tx.id],
        supplierIds: [tx.supplierId],
        metrics: { amountMinor: tx.amountMinor, baselineMedianMinor, multiple: Number((tx.amountMinor / baselineMedianMinor).toFixed(2)) },
      },
      // High value alone is not evidence of an overcharge, so no refund basis.
      refundEligible: false,
      suggestedRefundMinor: 0,
    }));
}

// ---------------------------------------------------------------------------
// ANOM-004 — category spend deviation against the comparison period
// ---------------------------------------------------------------------------

function spendDeviationFindings(
  all: readonly AnalysisTransaction[],
  window: AnalysisWindow,
  config: AnomalyConfig,
): AnomalyFinding[] {
  const windowMs = parseTime(window.to) - parseTime(window.from);
  if (windowMs <= 0) return [];
  const baselineFrom = new Date(parseTime(window.from) - windowMs).toISOString();
  const baselineTo = window.from;

  const sumByCategory = (fromIso: string, toIso: string): Map<string, { total: number; ids: string[]; supplierIds: Set<string> }> => {
    const map = new Map<string, { total: number; ids: string[]; supplierIds: Set<string> }>();
    for (const tx of all) {
      if (tx.occurredAt < fromIso || tx.occurredAt >= toIso) continue;
      if (tx.status === 'REFUNDED') continue;
      const entry = map.get(tx.category) ?? { total: 0, ids: [], supplierIds: new Set<string>() };
      entry.total += tx.amountMinor;
      entry.ids.push(tx.id);
      entry.supplierIds.add(tx.supplierId);
      map.set(tx.category, entry);
    }
    return map;
  };

  const current = sumByCategory(window.from, window.to);
  const baseline = sumByCategory(baselineFrom, baselineTo);

  const findings: AnomalyFinding[] = [];
  for (const [category, entry] of [...current.entries()].sort(([a], [b]) => (a < b ? -1 : 1))) {
    const baselineEntry = baseline.get(category);
    if (!baselineEntry || baselineEntry.total <= 0) continue;
    const ratio = entry.total / baselineEntry.total;
    if (ratio < config.deviationMultiplier) continue;
    findings.push({
      id: `${AnomalyRuleId.SPEND_DEVIATION}:${sha256(`${category}:${window.from}:${window.to}`).slice(0, 16)}`,
      ruleId: AnomalyRuleId.SPEND_DEVIATION,
      ruleVersion: config.version,
      severity: 'MEDIUM',
      title: 'Spend deviation against the comparison period',
      observations: [
        `Category "${category}" totals ${formatMinor(entry.total, 'USD')} in the analysed window versus ${formatMinor(baselineEntry.total, 'USD')} in the equivalent preceding period.`,
        `That is ${ratio.toFixed(2)}x the comparison period, above the configured ${config.deviationMultiplier}x threshold.`,
      ],
      evidence: {
        transactionIds: entry.ids,
        supplierIds: [...entry.supplierIds],
        metrics: { category, windowTotalMinor: entry.total, baselineTotalMinor: baselineEntry.total, ratio: Number(ratio.toFixed(2)) },
      },
      refundEligible: false,
      suggestedRefundMinor: 0,
    });
  }
  return findings;
}

// ---------------------------------------------------------------------------
// ANOM-005 — concentration of spend in one supplier
// ---------------------------------------------------------------------------

function supplierConcentrationFindings(
  txs: readonly AnalysisTransaction[],
  config: AnomalyConfig,
  totalSpendMinor: number,
): AnomalyFinding[] {
  if (totalSpendMinor <= 0) return [];
  const bySupplier = new Map<string, { total: number; ids: string[]; name: string }>();
  for (const tx of txs) {
    const entry = bySupplier.get(tx.supplierId) ?? { total: 0, ids: [], name: tx.supplierName };
    entry.total += tx.amountMinor;
    entry.ids.push(tx.id);
    bySupplier.set(tx.supplierId, entry);
  }

  const findings: AnomalyFinding[] = [];
  for (const [supplierId, entry] of [...bySupplier.entries()].sort(([a], [b]) => (a < b ? -1 : 1))) {
    const share = entry.total / totalSpendMinor;
    if (share < config.concentrationShare) continue;
    findings.push({
      id: `${AnomalyRuleId.SUPPLIER_CONCENTRATION}:${sha256(`${supplierId}:${entry.total}`).slice(0, 16)}`,
      ruleId: AnomalyRuleId.SUPPLIER_CONCENTRATION,
      ruleVersion: config.version,
      severity: 'LOW',
      title: 'Spend concentrated in a single supplier',
      observations: [
        `${entry.name} accounts for ${(share * 100).toFixed(1)}% of spend in the analysed window.`,
        `Total ${formatMinor(entry.total, 'USD')} across ${entry.ids.length} transactions.`,
      ],
      evidence: {
        transactionIds: entry.ids,
        supplierIds: [supplierId],
        metrics: { share: Number(share.toFixed(4)), supplierTotalMinor: entry.total, windowTotalMinor: totalSpendMinor },
      },
      refundEligible: false,
      suggestedRefundMinor: 0,
    });
  }
  return findings;
}

function formatMinor(amountMinor: number, currency: string): string {
  const whole = Math.trunc(amountMinor / 100);
  const fraction = Math.abs(amountMinor % 100)
    .toString()
    .padStart(2, '0');
  return `${currency} ${whole}.${fraction}`;
}
