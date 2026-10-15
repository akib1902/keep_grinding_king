'use client';

import { AppShell } from '@/components/layout/app-shell';
import { RequireSession } from '@/features/auth/session-provider';

export default function AuthenticatedLayout({ children }: { children: React.ReactNode }) {
  return (
    <RequireSession>
      <AppShell>{children}</AppShell>
    </RequireSession>
  );
}
