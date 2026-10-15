import { AlertTriangle, CheckCircle2, Info, ShieldAlert } from 'lucide-react';
import type { ComponentProps } from 'react';
import { cn } from '@/lib/cn';
import type { Tone } from '@/lib/status';

const TONE_STYLES: Record<Tone, { wrapper: string; icon: typeof Info }> = {
  neutral: { wrapper: 'border-border bg-surface-muted text-foreground', icon: Info },
  info: { wrapper: 'border-info-border bg-info-surface text-foreground', icon: Info },
  success: { wrapper: 'border-success-border bg-success-surface text-foreground', icon: CheckCircle2 },
  warning: { wrapper: 'border-warning-border bg-warning-surface text-foreground', icon: AlertTriangle },
  danger: { wrapper: 'border-danger-border bg-danger-surface text-foreground', icon: ShieldAlert },
};

export interface AlertProps extends Omit<ComponentProps<'div'>, 'title'> {
  tone?: Tone;
  title?: string;
  /** `alert` interrupts the screen reader; `status` is polite. */
  role?: 'alert' | 'status' | 'note';
}

export function Alert({ tone = 'info', title, className, children, role = 'status', ...props }: AlertProps) {
  const style = TONE_STYLES[tone];
  const Icon = style.icon;
  return (
    <div role={role} className={cn('flex gap-3 rounded-md border px-4 py-3 text-sm', style.wrapper, className)} {...props}>
      <Icon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-muted" />
      <div className="flex flex-col gap-1">
        {title ? <p className="font-medium">{title}</p> : null}
        {children ? <div className="text-sm text-secondary">{children}</div> : null}
      </div>
    </div>
  );
}
