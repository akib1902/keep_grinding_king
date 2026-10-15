'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { LogOut, Menu, UserCircle2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ServiceIndicator } from './service-indicator';
import { ThemeToggle } from './theme-toggle';
import { useSession } from '@/features/auth/session-provider';
import { cn } from '@/lib/cn';
import { roleLabel } from '@/lib/status';

export function Topbar({ title, onOpenMenu }: { title: string; onOpenMenu: () => void }) {
  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-border bg-surface/95 px-4 backdrop-blur">
      <Button variant="ghost" size="icon" className="lg:hidden" onClick={onOpenMenu} aria-label="Open navigation menu">
        <Menu aria-hidden="true" />
      </Button>
      <h1 className="truncate text-sm font-semibold text-foreground">{title}</h1>
      <div className="ml-auto flex items-center gap-1.5">
        <ServiceIndicator />
        <ThemeToggle />
        <UserMenu />
      </div>
    </header>
  );
}

function UserMenu() {
  const { session, role, signOut } = useSession();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const router = useRouter();

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent): void => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  if (!session || !role) {
    return (
      <Button variant="ghost" size="icon" aria-label="Not signed in" disabled>
        <UserCircle2 aria-hidden="true" />
      </Button>
    );
  }

  const initials = session.displayName
    .split(/[\s@.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join('');

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Account menu for ${session.displayName}`}
        className="flex size-9 items-center justify-center rounded-full border border-border bg-surface-muted text-xs font-semibold text-foreground transition-colors hover:bg-secondary-surface"
      >
        {initials || <UserCircle2 aria-hidden="true" className="size-4" />}
      </button>
      {open ? (
        <div
          role="menu"
          className="animate-lf-slide-in absolute right-0 mt-2 w-72 rounded-lg border border-border bg-surface p-4 shadow-xl"
        >
          <div className="flex flex-col gap-1">
            <p className="text-sm font-medium text-foreground">{session.displayName}</p>
            <p className="truncate text-xs text-muted">{session.claims.email || session.claims.sub}</p>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <Badge tone="info">{roleLabel(role)}</Badge>
            <Badge tone="neutral">tenant {session.claims.tenant_id}</Badge>
          </div>
          <dl className="mt-3 flex flex-col gap-1 border-t border-border pt-3 text-xs text-muted">
            <div className="flex justify-between gap-3">
              <dt>Session expires</dt>
              <dd className="tnum">{new Date(session.expiresAt).toLocaleTimeString('en-GB', { hour12: false })}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt>Issuer</dt>
              <dd className="truncate font-mono">{session.claims.iss || '—'}</dd>
            </div>
          </dl>
          <Button
            variant="secondary"
            size="sm"
            className={cn('mt-3 w-full justify-center')}
            onClick={() => {
              signOut();
              setOpen(false);
              router.replace('/login');
            }}
          >
            <LogOut aria-hidden="true" />
            Sign out
          </Button>
        </div>
      ) : null}
    </div>
  );
}
