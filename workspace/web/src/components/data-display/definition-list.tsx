'use client';

import { useState, type ReactNode } from 'react';
import { Check, Copy } from 'lucide-react';
import { cn } from '@/lib/cn';

export interface DefinitionItem {
  term: string;
  value: ReactNode;
  /** Renders the value in a monospace tabular style, for ids and codes. */
  mono?: boolean;
  /** Hides the row when the value is empty. */
  hideWhenEmpty?: boolean;
}

export function DefinitionList({ items, columns = 2, className }: { items: readonly DefinitionItem[]; columns?: 1 | 2 | 3; className?: string }) {
  const visible = items.filter((item) => !(item.hideWhenEmpty && (item.value === null || item.value === undefined || item.value === '—')));
  const gridClass = columns === 3 ? 'sm:grid-cols-2 lg:grid-cols-3' : columns === 2 ? 'sm:grid-cols-2' : '';
  return (
    <dl className={cn('grid grid-cols-1 gap-x-8 gap-y-4', gridClass, className)}>
      {visible.map((item) => (
        <div key={item.term} className="flex min-w-0 flex-col gap-1">
          <dt className="text-[11px] font-medium tracking-wide text-muted uppercase">{item.term}</dt>
          <dd className={cn('min-w-0 text-sm break-words text-foreground', item.mono && 'font-mono text-[13px]')}>{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Copies a technical identifier without relying on text selection. */
export function CopyableId({ value, label, className }: { value: string; label?: string; className?: string }) {
  const [copied, setCopied] = useState(false);

  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1_500);
    } catch {
      // Clipboard access can be denied; the value stays visible and selectable.
      setCopied(false);
    }
  };

  return (
    <span className={cn('inline-flex items-center gap-1.5', className)}>
      <code className="font-mono text-[13px] text-secondary">{value}</code>
      <button
        type="button"
        onClick={() => void copy()}
        aria-label={`Copy ${label ?? 'identifier'}`}
        className="rounded p-0.5 text-muted transition-colors hover:text-foreground"
      >
        {copied ? <Check aria-hidden="true" className="size-3.5 text-success" /> : <Copy aria-hidden="true" className="size-3.5" />}
      </button>
      <span aria-live="polite" className="sr-only">
        {copied ? 'Copied to clipboard' : ''}
      </span>
    </span>
  );
}
