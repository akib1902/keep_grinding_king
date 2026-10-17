import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

export interface Breadcrumb {
  label: string;
  href?: string;
}

export interface PageHeaderProps {
  title: string;
  breadcrumbs?: readonly Breadcrumb[];
  /** Status badge or reference line rendered beneath the title. */
  meta?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
  /** Constrains report-oriented pages to a readable measure (FDD §6.1). */
  constrained?: boolean;
}

export function PageHeader({ title, breadcrumbs, meta, description, actions, className, constrained }: PageHeaderProps) {
  return (
    <header className={cn('flex flex-col gap-3', constrained && 'max-w-4xl', className)}>
      {breadcrumbs && breadcrumbs.length > 0 ? (
        <nav aria-label="Breadcrumb">
          <ol className="flex flex-wrap items-center gap-1 text-xs text-muted">
            {breadcrumbs.map((crumb, index) => (
              <li key={`${crumb.label}-${index}`} className="flex items-center gap-1">
                {crumb.href ? (
                  <Link href={crumb.href} className="transition-colors hover:text-foreground">
                    {crumb.label}
                  </Link>
                ) : (
                  <span className="text-secondary">{crumb.label}</span>
                )}
                {index < breadcrumbs.length - 1 ? <ChevronRight aria-hidden="true" className="size-3" /> : null}
              </li>
            ))}
          </ol>
        </nav>
      ) : null}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-2">
          <h2 className="text-[28px] leading-tight font-semibold tracking-tight text-foreground">{title}</h2>
          {meta ? <div className="flex flex-wrap items-center gap-2">{meta}</div> : null}
          {description ? <div className="max-w-3xl text-sm text-muted">{description}</div> : null}
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
    </header>
  );
}
