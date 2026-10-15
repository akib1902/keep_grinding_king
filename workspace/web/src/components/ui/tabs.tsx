'use client';

import { useId, useRef, type ReactNode } from 'react';
import { cn } from '@/lib/cn';

export interface TabItem {
  id: string;
  label: string;
  /** Optional count rendered next to the label. */
  count?: number;
}

export interface TabsProps {
  items: readonly TabItem[];
  value: string;
  onChange: (id: string) => void;
  /** Rendered beneath the strip for the active tab. */
  children?: ReactNode;
  className?: string;
  'aria-label'?: string;
}

/**
 * Tab strip implementing the ARIA tabs pattern: roving tabindex, arrow-key
 * navigation, Home/End support. Tabs here filter visible content rather than
 * hide a panel, so the selected tab also marks the active filter.
 */
export function Tabs({ items, value, onChange, children, className, 'aria-label': ariaLabel }: TabsProps) {
  const baseId = useId();
  const listRef = useRef<HTMLDivElement | null>(null);

  const move = (direction: 1 | -1 | 'first' | 'last'): void => {
    const buttons = Array.from(listRef.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]') ?? []);
    if (buttons.length === 0) return;
    const currentIndex = buttons.findIndex((button) => button.dataset.tabId === value);
    let nextIndex: number;
    if (direction === 'first') nextIndex = 0;
    else if (direction === 'last') nextIndex = buttons.length - 1;
    else nextIndex = (currentIndex + direction + buttons.length) % buttons.length;
    const next = buttons[nextIndex];
    if (!next) return;
    onChange(next.dataset.tabId ?? value);
    next.focus();
  };

  return (
    <div className={cn('flex flex-col gap-4', className)}>
      <div
        ref={listRef}
        role="tablist"
        aria-label={ariaLabel}
        onKeyDown={(event) => {
          if (event.key === 'ArrowRight') {
            event.preventDefault();
            move(1);
          } else if (event.key === 'ArrowLeft') {
            event.preventDefault();
            move(-1);
          } else if (event.key === 'Home') {
            event.preventDefault();
            move('first');
          } else if (event.key === 'End') {
            event.preventDefault();
            move('last');
          }
        }}
        className="flex flex-wrap items-center gap-1 border-b border-border"
      >
        {items.map((item) => {
          const selected = item.id === value;
          return (
            <button
              key={item.id}
              type="button"
              role="tab"
              id={`${baseId}-${item.id}`}
              data-tab-id={item.id}
              aria-selected={selected}
              aria-controls={`${baseId}-${item.id}-panel`}
              tabIndex={selected ? 0 : -1}
              onClick={() => onChange(item.id)}
              className={cn(
                '-mb-px flex items-center gap-2 border-b-2 px-3 py-2 text-sm font-medium transition-colors',
                selected
                  ? 'border-primary text-foreground'
                  : 'border-transparent text-muted hover:border-border-strong hover:text-foreground',
              )}
            >
              {item.label}
              {item.count !== undefined ? (
                <span
                  className={cn(
                    'tnum rounded-full px-1.5 py-0.5 text-[11px]',
                    selected ? 'bg-secondary-surface text-foreground' : 'bg-surface-muted text-muted',
                  )}
                >
                  {item.count}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
      <div role="tabpanel" id={`${baseId}-${value}-panel`} aria-labelledby={`${baseId}-${value}`}>
        {children}
      </div>
    </div>
  );
}
