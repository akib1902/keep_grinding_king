'use client';

import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from 'lucide-react';
import { cn } from '@/lib/cn';
import type { Tone } from '@/lib/status';

export interface ToastInput {
  title: string;
  description?: string;
  tone?: Tone;
  /** Milliseconds before auto-dismiss; `0` keeps it until dismissed. */
  durationMs?: number;
}

interface ToastRecord extends Required<Omit<ToastInput, 'description'>> {
  id: string;
  description: string | undefined;
}

interface ToastApi {
  toast: (input: ToastInput) => string;
  dismiss: (id: string) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

const TONE_ICON: Record<Tone, typeof Info> = {
  neutral: Info,
  info: Info,
  success: CheckCircle2,
  warning: AlertTriangle,
  danger: XCircle,
};

const TONE_CLASS: Record<Tone, string> = {
  neutral: 'border-border',
  info: 'border-info-border',
  success: 'border-success-border',
  warning: 'border-warning-border',
  danger: 'border-danger-border',
};

function createToastId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `toast-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastRecord[]>([]);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: string) => {
    const timer = timers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
    setToasts((current) => current.filter((item) => item.id !== id));
  }, []);

  const toast = useCallback(
    (input: ToastInput) => {
      const tone = input.tone ?? 'info';
      const record: ToastRecord = {
        id: createToastId(),
        title: input.title,
        description: input.description,
        tone,
        durationMs: input.durationMs ?? (tone === 'danger' ? 10_000 : 6_000),
      };
      setToasts((current) => [...current.slice(-3), record]);
      if (record.durationMs > 0) {
        timers.current.set(
          record.id,
          setTimeout(() => dismiss(record.id), record.durationMs),
        );
      }
      return record.id;
    },
    [dismiss],
  );

  const api = useMemo<ToastApi>(() => ({ toast, dismiss }), [toast, dismiss]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div
        // `polite` keeps transient feedback from interrupting a screen reader
        // mid-sentence (FDD §14).
        aria-live="polite"
        aria-atomic="false"
        className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-[min(24rem,calc(100vw-2rem))] flex-col gap-2"
      >
        {toasts.map((item) => {
          const Icon = TONE_ICON[item.tone];
          return (
            <div
              key={item.id}
              className={cn(
                'animate-lf-slide-in pointer-events-auto flex items-start gap-3 rounded-lg border bg-surface px-4 py-3 shadow-lg',
                TONE_CLASS[item.tone],
              )}
            >
              <Icon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-muted" />
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <p className="text-sm font-medium text-foreground">{item.title}</p>
                {item.description ? <p className="text-xs text-muted">{item.description}</p> : null}
              </div>
              <button
                type="button"
                onClick={() => dismiss(item.id)}
                aria-label={`Dismiss notification: ${item.title}`}
                className="rounded p-0.5 text-muted transition-colors hover:text-foreground"
              >
                <X className="size-4" />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const context = useContext(ToastContext);
  if (!context) throw new Error('useToast must be used inside a ToastProvider.');
  return context;
}
