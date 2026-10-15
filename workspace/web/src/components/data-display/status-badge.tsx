import { CheckCircle2, Circle, CircleDashed, Info, ShieldAlert, XCircle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/cn';
import {
  approvalStatusMeta,
  proposalStatusMeta,
  runStatusMeta,
  settlementStatusMeta,
  stepStatusMeta,
  type StatusMeta,
  type Tone,
} from '@/lib/status';

const TONE_ICON: Record<Tone, typeof Info> = {
  neutral: Circle,
  info: CircleDashed,
  success: CheckCircle2,
  warning: ShieldAlert,
  danger: XCircle,
};

/**
 * A status is always rendered as an icon **plus** a readable label: colour alone
 * never carries the meaning (FDD §8.2, §14).
 */
export function StatusBadge({ meta, size = 'md', className }: { meta: StatusMeta; size?: 'sm' | 'md'; className?: string }) {
  const Icon = TONE_ICON[meta.tone];
  return (
    <Badge tone={meta.tone} size={size} className={cn(size === 'md' ? 'px-2.5 py-1' : undefined, className)} title={meta.description}>
      <Icon aria-hidden="true" className={meta.live ? 'animate-lf-pulse' : undefined} />
      {meta.label}
    </Badge>
  );
}

export function RunStatusBadge({ status, size }: { status: string; size?: 'sm' | 'md' }) {
  return <StatusBadge meta={runStatusMeta(status)} size={size} />;
}

export function ProposalStatusBadge({ status, size }: { status: string; size?: 'sm' | 'md' }) {
  return <StatusBadge meta={proposalStatusMeta(status)} size={size} />;
}

export function ApprovalStatusBadge({ status, size }: { status: string; size?: 'sm' | 'md' }) {
  return <StatusBadge meta={approvalStatusMeta(status)} size={size} />;
}

export function SettlementStatusBadge({ status, size }: { status: string; size?: 'sm' | 'md' }) {
  return <StatusBadge meta={settlementStatusMeta(status)} size={size} />;
}

export function StepStatusBadge({ status, size }: { status: string; size?: 'sm' | 'md' }) {
  return <StatusBadge meta={stepStatusMeta(status)} size={size} />;
}

/** Compact inline dot for dense timelines, still paired with a text label. */
export function StatusDot({ tone, live }: { tone: Tone; live?: boolean }) {
  const color: Record<Tone, string> = {
    neutral: 'bg-muted',
    info: 'bg-info',
    success: 'bg-success',
    warning: 'bg-warning',
    danger: 'bg-danger',
  };
  return <span aria-hidden="true" className={cn('size-2 rounded-full', color[tone], live && 'animate-lf-pulse')} />;
}
