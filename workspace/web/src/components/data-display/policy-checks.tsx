import { AlertTriangle, Check, Info, ShieldAlert } from 'lucide-react';
import { cn } from '@/lib/cn';
import { policyCheckMeta } from '@/lib/status';

export interface PolicyCheck {
  ruleId: string;
  passed: boolean;
  detail?: string;
}

const TONE: Record<string, { icon: typeof Check; className: string; word: string }> = {
  success: { icon: Check, className: 'text-success', word: 'text-secondary' },
  info: { icon: Info, className: 'text-info', word: 'text-secondary' },
  warning: { icon: AlertTriangle, className: 'text-warning', word: 'font-medium text-warning' },
  danger: { icon: ShieldAlert, className: 'text-danger', word: 'font-medium text-danger' },
  neutral: { icon: Info, className: 'text-muted', word: 'text-muted' },
};

/**
 * The rule-by-rule policy decision.
 *
 * Each row shows an icon, a word and the rule's own detail text, so the outcome
 * is legible without relying on colour. The threshold rule is rendered as
 * "triggered" rather than "failed", because a triggered threshold is what pauses
 * the run for approval — not a refusal.
 */
export function PolicyCheckList({ checks, className }: { checks: readonly PolicyCheck[]; className?: string }) {
  if (checks.length === 0) {
    return <p className="text-sm text-muted">The backend returned no policy checks for this proposal.</p>;
  }
  return (
    <ul className={cn('flex flex-col gap-1.5', className)}>
      {checks.map((check) => {
        const meta = policyCheckMeta(check.ruleId, check.passed);
        const tone = TONE[meta.tone] ?? TONE.neutral!;
        const Icon = tone.icon;
        return (
          <li key={check.ruleId} className="flex items-start gap-2 text-sm">
            <Icon aria-hidden="true" className={cn('mt-0.5 size-3.5 shrink-0', tone.className)} />
            <span className="min-w-0">
              <span className="font-mono text-[12px] text-muted">{check.ruleId}</span>{' '}
              <span className={tone.word}>{meta.word}</span> · {meta.label}
              {check.detail ? <span className="text-muted"> — {check.detail}</span> : null}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
