'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { requestDevToken, type SignInInput } from './api';
import {
  clearSession,
  decodeClaims,
  getSession,
  loadSession,
  setSession,
  subscribeSession,
  type Session,
} from '@/lib/session-store';
import { Skeleton } from '@/components/ui/skeleton';
import type { Role } from '@/types/api';

export type SessionStatus = 'loading' | 'authenticated' | 'anonymous';

export interface SessionContextValue {
  status: SessionStatus;
  session: Session | null;
  role: Role | null;
  signIn: (input: SignInInput) => Promise<Session>;
  signOut: () => void;
  /** Whether the current role may record an approval decision. */
  canDecide: boolean;
  /** Whether the current role sees the operational/settings surfaces. */
  isAdmin: boolean;
}

const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  // `undefined` means "not read from storage yet", which is different from
  // "signed out" and must not trigger a redirect.
  const [session, setSessionState] = useState<Session | null | undefined>(undefined);

  useEffect(() => {
    setSessionState(loadSession());
    return subscribeSession(() => setSessionState(getSession()));
  }, []);

  const signIn = useCallback(async (input: SignInInput) => {
    const response = await requestDevToken(input);
    const claims = decodeClaims(response.token);
    if (!claims) throw new Error('The issued token could not be decoded; refusing to start a session.');
    const next: Session = {
      token: response.token,
      // Prefer the server's own expiry claim over the advertised duration.
      expiresAt: claims.exp * 1_000,
      claims,
      displayName: input.name ?? claims.email,
    };
    setSession(next);
    return next;
  }, []);

  const signOut = useCallback(() => {
    clearSession();
  }, []);

  const value = useMemo<SessionContextValue>(() => {
    const resolved = session ?? null;
    const role = resolved?.claims.role ?? null;
    return {
      status: session === undefined ? 'loading' : resolved ? 'authenticated' : 'anonymous',
      session: resolved,
      role,
      signIn,
      signOut,
      canDecide: role === 'APPROVER' || role === 'ADMIN',
      isAdmin: role === 'ADMIN',
    };
  }, [session, signIn, signOut]);

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const context = useContext(SessionContext);
  if (!context) throw new Error('useSession must be used inside a SessionProvider.');
  return context;
}

/**
 * Client-side route guard. This is a usability affordance only: every protected
 * action is authorised by the backend regardless of what the browser renders
 * (FDD §12.2).
 */
export function RequireSession({ children }: { children: ReactNode }) {
  const { status } = useSession();
  const router = useRouter();

  useEffect(() => {
    if (status === 'anonymous') router.replace('/login');
  }, [status, router]);

  if (status === 'loading') {
    return (
      <div className="flex flex-col gap-4 p-6" aria-busy="true" aria-live="polite">
        <span className="sr-only">Checking your session…</span>
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-4 w-96" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <Skeleton key={index} className="h-24 w-full" />
          ))}
        </div>
      </div>
    );
  }

  if (status === 'anonymous') {
    return (
      <div className="p-6 text-sm text-muted" role="status">
        Redirecting to sign in…
      </div>
    );
  }

  return <>{children}</>;
}
