'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Boxes } from 'lucide-react';
import { cn } from '@/lib/cn';
import { NAV_ITEMS, isActive } from './nav';

export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <Boxes aria-hidden="true" className="size-5 text-primary" />
      <div className={cn('flex flex-col leading-tight', compact && 'sr-only')}>
        <span className="text-[15px] font-semibold tracking-tight text-foreground">LedgerFlow</span>
        <span className="text-[11px] text-muted">Financial operations console</span>
      </div>
    </div>
  );
}

export interface SidebarProps {
  /** Called after a navigation link is activated (closes the mobile drawer). */
  onNavigate?: () => void;
  className?: string;
}

export function Sidebar({ onNavigate, className }: SidebarProps) {
  const pathname = usePathname() ?? '';
  return (
    <nav aria-label="Primary" className={cn('flex h-full flex-col gap-6 border-r border-border bg-surface px-3 py-4', className)}>
      <div className="px-2">
        <Brand />
      </div>
      <ul className="flex flex-col gap-0.5">
        {NAV_ITEMS.map((item) => {
          const active = isActive(item, pathname);
          const Icon = item.icon;
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                onClick={onNavigate}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                  active ? 'bg-secondary-surface text-foreground' : 'text-secondary hover:bg-surface-muted hover:text-foreground',
                )}
              >
                <Icon aria-hidden="true" className={cn('size-4 shrink-0', active ? 'text-primary' : 'text-muted')} />
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
      <div className="mt-auto rounded-md border border-border bg-surface-muted px-3 py-2">
        <p className="text-[11px] leading-relaxed text-muted">
          All settlement in this deployment is simulated. No real funds move.
        </p>
      </div>
    </nav>
  );
}
