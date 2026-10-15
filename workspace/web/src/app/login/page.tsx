'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AlertTriangle, Boxes } from 'lucide-react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, Input } from '@/components/ui/field';
import { useSession } from '@/features/auth/session-provider';
import { useReadiness } from '@/features/system/hooks';
import { API_BASE_URL, DEFAULT_ROLE } from '@/lib/config';
import { describeApiError } from '@/lib/errors';
import { roleLabel } from '@/lib/status';
import type { Role } from '@/types/api';

const ROLE_OPTIONS: readonly { role: Role; description: string; email: string }[] = [
  { role: 'ANALYST', description: 'Submits research requests and reviews findings.', email: 'analyst@example.test' },
  { role: 'APPROVER', description: 'Decides refund proposals that require approval.', email: 'approver@example.test' },
  { role: 'ADMIN', description: 'Sees every run and the operational surfaces.', email: 'admin@example.test' },
];

export default function LoginPage() {
  const { status, signIn } = useSession();
  const router = useRouter();
  const readiness = useReadiness();
  const [role, setRole] = useState<Role>((DEFAULT_ROLE as Role) ?? 'ANALYST');
  const [email, setEmail] = useState(
    ROLE_OPTIONS.find((option) => option.role === DEFAULT_ROLE)?.email ?? 'analyst@example.test',
  );
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (status === 'authenticated') router.replace('/overview');
  }, [status, router]);

  const chooseRole = (next: Role): void => {
    setRole(next);
    setEmail(ROLE_OPTIONS.find((option) => option.role === next)?.email ?? email);
  };

  const submit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await signIn({ role, email: email.trim() });
      router.replace('/overview');
    } catch (caught) {
      setError(describeApiError(caught));
    } finally {
      setSubmitting(false);
    }
  };

  const apiUnreachable = readiness.isError;

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-3xl flex-col justify-center gap-6 p-6">
      <header className="flex items-center gap-3">
        <Boxes aria-hidden="true" className="size-6 text-primary" />
        <div className="flex flex-col leading-tight">
          <h1 className="text-lg font-semibold tracking-tight text-foreground">LedgerFlow</h1>
          <p className="text-xs text-muted">Financial operations console</p>
        </div>
      </header>

      {apiUnreachable ? (
        <Alert tone="danger" role="alert" title="The backend API is not reachable">
          <p>
            The console could not reach <code className="font-mono">{API_BASE_URL}</code>. Start it with{' '}
            <code className="font-mono">npm run dev:api</code> and <code className="font-mono">npm run dev:worker</code>, then reload.
          </p>
        </Alert>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Sign in</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          <form className="flex flex-col gap-5" onSubmit={(event) => void submit(event)} noValidate>
            <div className="grid gap-3 sm:grid-cols-3">
              {ROLE_OPTIONS.map((option) => {
                const selected = option.role === role;
                return (
                  <button
                    key={option.role}
                    type="button"
                    onClick={() => chooseRole(option.role)}
                    aria-pressed={selected}
                    className={`flex flex-col gap-1 rounded-lg border p-3 text-left transition-colors ${
                      selected ? 'border-primary bg-secondary-surface' : 'border-border bg-surface hover:bg-surface-muted'
                    }`}
                  >
                    <span className="text-sm font-medium text-foreground">{roleLabel(option.role)}</span>
                    <span className="text-xs text-muted">{option.description}</span>
                  </button>
                );
              })}
            </div>

            <Field label="Email" htmlFor="login-email" required hint="Used to create or resolve the local user record.">
              <Input
                id="login-email"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                autoComplete="username"
                required
              />
            </Field>

            {error ? (
              <Alert tone="danger" role="alert" title="Sign in failed">
                {error}
              </Alert>
            ) : null}

            <Button type="submit" disabled={submitting || apiUnreachable} className="self-start">
              {submitting ? 'Signing in…' : `Continue as ${roleLabel(role)}`}
            </Button>
          </form>

          <Alert tone="warning" title="Local development authentication">
            <p className="flex items-start gap-2">
              <AlertTriangle aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
              <span>
                This build signs in through the backend&apos;s <code className="font-mono">POST /api/auth/dev-token</code> endpoint, which is
                available only while <code className="font-mono">ENABLE_DEV_TOKENS=true</code>. The token is held in session storage for this tab
                and expires after one hour. Production deployments replace this screen with a real identity provider, and the backend keeps
                authorising every action regardless of what this screen shows.
              </span>
            </p>
          </Alert>
        </CardContent>
      </Card>

      <p className="text-xs text-muted">
        All financial data in this deployment is synthetic and every settlement is simulated. No real funds move.
      </p>
    </main>
  );
}
