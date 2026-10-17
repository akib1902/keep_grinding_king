import Link from 'next/link';
import type { ReactNode } from 'react';
import { ArrowRight } from 'lucide-react';
import { cn } from '@/lib/cn';

export interface MetricCardProps {
  label: string;
  /** `null` renders the explicit unavailable state rather than a misleading zero. */
  value: ReactNode | null;
  hint?: ReactNode;
  /** Turns the card into a link to the filtered list it summarises. */
  href?: string;
  icon?: ReactNode;
  className?: string;
  /** Shown instead of the value when the underlying request failed. */
  unavailableLabel?: string;
}

export function MetricCard({
  label,
  value,
  hint,
  href,
  icon,
  className,
  unavailableLabel = 'Unavailable',
}: MetricCardProps) {
  const unavailable = value === null;
  const body = (
    <>
      <div className="flex items-center justify-between gap-3">
        <p className="text-[15px] text-muted">{label}</p>
        {icon ? <span className="text-muted">{icon}</span> : null}
      </div>
      <p
        className={cn(
          'tnum font-semibold',
          unavailable ? 'text-lg leading-tight text-muted' : 'text-[28px] leading-tight text-foreground',
        )}
      >
        {unavailable ? unavailableLabel : value}
      </p>
      <div className="flex min-h-5 items-center gap-2 text-[13px] text-muted">
        {hint}
        {href ? <ArrowRight aria-hidden="true" className="size-3.5 opacity-0 transition-opacity group-hover:opacity-100" /> : null}
      </div>
    </>
  );

  const base = 'group flex flex-col gap-2 rounded-lg border border-border bg-surface p-5 text-left transition-colors';

  if (href) {
    return (
      <Link href={href} className={cn(base, 'hover:border-border-strong hover:bg-surface-muted', className)}>
        {body}
      </Link>
    );
  }
  return <div className={cn(base, className)}>{body}</div>;
}
