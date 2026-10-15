import { FileSearch, ShieldCheck, ShieldX } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from './states';
import { cn } from '@/lib/cn';
import { formatEvidenceValue, formatMoney, humanizeEnum, shortId } from '@/lib/formatters';
import type { Tone } from '@/lib/status';
import type { AnomalyFinding } from '@/types/api';

const SEVERITY_TONE: Record<string, Tone> = { HIGH: 'danger', MEDIUM: 'warning', LOW: 'info' };

/**
 * Presents one deterministic finding (FDD §7.4C).
 *
 * The card separates two things the product is careful about: the measured
 * observations (deterministic rule output) and the AI narrative, which is
 * rendered separately and labelled as interpretation. Nothing here claims fraud.
 */
export function FindingCard({
  finding,
  interpretation,
  className,
}: {
  finding: AnomalyFinding;
  /** Model-authored narrative for this finding, if the report highlighted it. */
  interpretation?: string;
  className?: string;
}) {
  const severityTone = SEVERITY_TONE[finding.severity] ?? 'neutral';
  return (
    <article className={cn('flex flex-col gap-3 rounded-lg border border-border bg-surface p-4', className)}>
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex items-start gap-2">
          <FileSearch aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-muted" />
          <div className="flex flex-col gap-0.5">
            <h3 className="text-sm font-semibold text-foreground">{finding.title}</h3>
            <p className="font-mono text-[11px] text-muted">
              {finding.ruleId} · rule {finding.ruleVersion} · {shortId(finding.id, 12)}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={severityTone}>{humanizeEnum(finding.severity)} severity</Badge>
          {finding.refundEligible ? (
            <Badge tone="success">
              <ShieldCheck aria-hidden="true" />
              Refund eligible up to {formatMoney(finding.suggestedRefundMinor)}
            </Badge>
          ) : (
            <Badge tone="neutral">
              <ShieldX aria-hidden="true" />
              No refund basis
            </Badge>
          )}
        </div>
      </header>

      <div className="flex flex-col gap-1">
        <p className="text-xs font-semibold tracking-wide text-muted uppercase">Measured evidence</p>
        <ul className="flex list-disc flex-col gap-1 pl-4 text-sm text-secondary">
          {finding.observations.map((observation) => (
            <li key={observation}>{observation}</li>
          ))}
        </ul>
      </div>

      {Object.keys(finding.evidence.metrics).length > 0 ? (
        <dl className="flex flex-wrap gap-x-6 gap-y-2">
          {Object.entries(finding.evidence.metrics).map(([key, value]) => (
            <div key={key} className="flex flex-col">
              <dt className="text-[11px] tracking-wide text-muted uppercase">{humanizeEnum(key)}</dt>
              <dd className="tnum text-sm text-foreground">{formatEvidenceValue(value)}</dd>
            </div>
          ))}
        </dl>
      ) : null}

      {finding.evidence.transactionIds.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted">Supporting transactions:</span>
          {finding.evidence.transactionIds.map((id) => (
            <code key={id} className="rounded border border-border bg-surface-muted px-1.5 py-0.5 font-mono text-[11px] text-secondary">
              {shortId(id, 8)}
            </code>
          ))}
        </div>
      ) : null}

      {interpretation ? (
        <div className="rounded-md border border-border bg-surface-muted px-3 py-2">
          <p className="text-[11px] font-semibold tracking-wide text-muted uppercase">Model interpretation</p>
          <p className="text-sm text-secondary">{interpretation}</p>
        </div>
      ) : null}
    </article>
  );
}

export function FindingsList({
  findings,
  highlighted,
  interpretationSummary,
}: {
  findings: readonly AnomalyFinding[];
  highlighted?: readonly string[];
  interpretationSummary?: string;
}) {
  if (findings.length === 0) {
    return (
      <EmptyState
        title="No findings in this window"
        description="The deterministic rules found nothing to report for the analysed period. An empty result is a result, not a failure."
      />
    );
  }
  return (
    <div className="flex flex-col gap-3">
      {findings.map((finding) => (
        <FindingCard
          key={finding.id}
          finding={finding}
          interpretation={highlighted?.includes(finding.id) && interpretationSummary ? interpretationSummary : undefined}
        />
      ))}
    </div>
  );
}
