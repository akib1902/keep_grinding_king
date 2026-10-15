'use client';

import { useState, type ReactNode } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { createQueryClient } from '@/lib/query-client';
import { SessionProvider } from '@/features/auth/session-provider';
import { ToastProvider } from '@/components/feedback/toast';

/**
 * Client providers. The query client is created once per browser session so the
 * cache survives client-side navigation.
 */
export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(() => createQueryClient());
  return (
    <QueryClientProvider client={queryClient}>
      <SessionProvider>
        <ToastProvider>{children}</ToastProvider>
      </SessionProvider>
    </QueryClientProvider>
  );
}
