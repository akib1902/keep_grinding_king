'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/cn';
import { Sidebar } from './sidebar';
import { Topbar } from './topbar';
import { routeTitle } from './nav';

/**
 * Application shell (FDD §6).
 *
 * One consistent frame for every page — including loading, empty, error and
 * disconnected states, because the shell is rendered outside the page's data
 * boundary.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname() ?? '';
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Navigating always closes the drawer, so mobile users never land behind it.
  useEffect(() => {
    setDrawerOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!drawerOpen) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setDrawerOpen(false);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [drawerOpen]);

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[15rem_1fr]">
      {/* Desktop sidebar */}
      <aside className="hidden lg:sticky lg:top-0 lg:block lg:h-screen">
        <Sidebar />
      </aside>

      {/* Mobile drawer */}
      {drawerOpen ? (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-slate-900/40" onClick={() => setDrawerOpen(false)} aria-hidden="true" />
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Primary navigation"
            className="animate-lf-slide-in absolute inset-y-0 left-0 w-64 max-w-[80vw] bg-surface shadow-xl"
          >
            <Sidebar onNavigate={() => setDrawerOpen(false)} />
          </div>
        </div>
      ) : null}

      <div className={cn('flex min-w-0 flex-col')}>
        <Topbar title={routeTitle(pathname)} onOpenMenu={() => setDrawerOpen(true)} />
        <main id="content" className="min-w-0 flex-1 px-4 py-5 sm:px-6 sm:py-6">
          {children}
        </main>
      </div>
    </div>
  );
}
