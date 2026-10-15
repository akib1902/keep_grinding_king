'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { AlertTriangle, Inbox, TriangleAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';
import { describeApiError, isAuthorizationFailure } from '@/lib/errors';

/**
 * The four states every data-driven page must define (FDD §13): loading,
 * success, empty and error. These two components cover empty and error; loading
 * uses the skeletons in `components/ui/skeleton.tsx`.
 */

export function EmptyState({
  title,
  description,
  action,
  icon,
  className,
}: {
  title: string;
  description: ReactNode;
  action?: { label: string; href: string } | ReactNode;
  icon?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col items-center gap-3 px-6 py-12 text-center', className)}>
      <span className="flex size-10 items-center justify-center rounded-full bg-surface-muted text-muted">
        {icon ?? <Inbox aria-hidden="true" className="size-5" />}
      </span>
      <div className="flex flex-col gap-1">
        <p className="text-sm font-medium text-foreground">{title}</p>
        <div className="mx-auto max-w-prose text-sm text-muted">{description}</div>
      </div>
      {action && typeof action === 'object' && 'label' in action && 'href' in action ? (
        <Link
          href={(action as { href: string }).href}
          className="inline-flex h-9 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary-hover"
        >
          {(action as { label: string }).label}
        </Link>
      ) : (
        (action as ReactNode)
      )}
    </div>
  );
}

export interface ErrorStateProps {
  error: unknown;
  /** Retry handler; omitted when a retry cannot help. */
  onRetry?: () => void;
  title?: string;
  className?: string;
  /** Extra context, e.g. which section of the page failed. */
  context?: string;
}

export function ErrorState({ error, onRetry, title, className, context }: ErrorStateProps) {
  const forbidden = isAuthorizationFailure(error);
  const heading = title ?? (forbidden ? 'Not permitted' : 'Unable to load this data');
  return (
    <div
      role="alert"
      className={cn('flex flex-col items-start gap-3 rounded-lg border border-danger-border bg-danger-surface px-5 py-4', className)}
    >
      <div className="flex items-start gap-3">
        {forbidden ? (
          <AlertTriangle aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-danger" />
        ) : (
          <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-danger" />
        )}
        <div className="flex flex-col gap-1">
          <p className="text-sm font-medium text-foreground">{heading}</p>
          <p className="text-sm text-secondary">{describeApiError(error)}</p>
          {context ? <p className="text-xs text-muted">{context}</p> : null}
          {forbidden ? (
            <p className="text-xs text-muted">
              The backend rejected this request for the signed-in role. Hidden controls are never the access control.
            </p>
          ) : null}
        </div>
      </div>
      {onRetry && !forbidden ? (
        <Button variant="secondary" size="sm" onClick={onRetry}>
          Try again
        </Button>
      ) : null}
    </div>
  );
}

/**
 * Shown when the API reports a status this build does not recognise. The
 * identifier is preserved so an operator can quote it (FDD §13).
 */
export function UnknownStatusNotice({ identifier, status }: { identifier: string; status: string }) {
  return (
    <div className="flex items-center gap-2 rounded-md border border-border bg-surface-muted px-3 py-2 text-xs text-muted">
      <TriangleAlert aria-hidden="true" className="size-3.5" />
      <span>
        Unrecognised status <code className="font-mono">{status}</code> for <code className="font-mono">{identifier}</code> — showing a safe
        fallback.
      </span>
    </div>
  );
}
