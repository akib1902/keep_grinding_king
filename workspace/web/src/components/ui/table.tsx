import type { ComponentProps } from 'react';
import { cn } from '@/lib/cn';

/**
 * Table primitives. Dense financial tables scroll horizontally inside their own
 * container so the page itself never does (FDD §6.2).
 */
export function TableWrapper({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('w-full overflow-x-auto', className)} {...props} />;
}

export function Table({ className, ...props }: ComponentProps<'table'>) {
  return <table className={cn('w-full border-collapse text-sm', className)} {...props} />;
}

export function TableHead({ className, ...props }: ComponentProps<'thead'>) {
  return <thead className={cn('bg-surface-muted text-left', className)} {...props} />;
}

export function TableBody({ className, ...props }: ComponentProps<'tbody'>) {
  return <tbody className={cn('divide-y divide-border', className)} {...props} />;
}

export function TableRow({ className, ...props }: ComponentProps<'tr'>) {
  return <tr className={cn('border-b border-border last:border-0 hover:bg-surface-muted/60', className)} {...props} />;
}

export function TableHeaderCell({ className, ...props }: ComponentProps<'th'>) {
  return (
    <th
      scope="col"
      className={cn('whitespace-nowrap px-4 py-2.5 text-xs font-semibold text-muted uppercase tracking-wide', className)}
      {...props}
    />
  );
}

export function TableCell({ className, ...props }: ComponentProps<'td'>) {
  return <td className={cn('px-4 py-2.5 align-middle text-foreground', className)} {...props} />;
}
