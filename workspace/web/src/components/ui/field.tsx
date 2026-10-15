import type { ComponentProps, ReactNode } from 'react';
import { cn } from '@/lib/cn';

const controlClass =
  'w-full rounded-md border border-border-strong bg-surface px-3 py-2 text-sm text-foreground shadow-[0_1px_1px_rgba(15,23,42,0.03)] placeholder:text-muted disabled:cursor-not-allowed disabled:opacity-60';

export function Input({ className, ...props }: ComponentProps<'input'>) {
  return <input className={cn(controlClass, 'h-9', className)} {...props} />;
}

export function Textarea({ className, ...props }: ComponentProps<'textarea'>) {
  return <textarea className={cn(controlClass, 'min-h-24 resize-y', className)} {...props} />;
}

export function Select({ className, ...props }: ComponentProps<'select'>) {
  return <select className={cn(controlClass, 'h-9 pr-8', className)} {...props} />;
}

export interface FieldProps {
  label: string;
  htmlFor: string;
  hint?: string;
  error?: string | null;
  required?: boolean;
  children: ReactNode;
  className?: string;
}

/**
 * A labelled field wrapper. The error is rendered with `role="alert"` and wired
 * to the control via `aria-describedby`, so validation is announced rather than
 * only shown in red (FDD §14).
 */
export function Field({ label, htmlFor, hint, error, required, children, className }: FieldProps) {
  const descriptionId = `${htmlFor}-description`;
  const errorId = `${htmlFor}-error`;
  const describedBy = [hint ? descriptionId : null, error ? errorId : null].filter(Boolean).join(' ');
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <label htmlFor={htmlFor} className="text-sm font-medium text-foreground">
        {label}
        {required ? (
          <span aria-hidden="true" className="ml-1 text-danger">
            *
          </span>
        ) : null}
      </label>
      <div aria-describedby={describedBy || undefined}>{children}</div>
      {hint ? (
        <p id={descriptionId} className="text-xs text-muted">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} role="alert" className="text-xs font-medium text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** Marks a field as invalid for assistive technology and styling. */
export function invalidProps(invalid: boolean, errorId?: string): { 'aria-invalid'?: boolean; 'aria-describedby'?: string } {
  return invalid ? { 'aria-invalid': true, ...(errorId ? { 'aria-describedby': errorId } : {}) } : {};
}
