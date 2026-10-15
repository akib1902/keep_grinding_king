'use client';

import { useEffect, useState } from 'react';
import { Lock, Monitor, Moon, Sun } from 'lucide-react';
import { PageHeader } from '@/components/layout/page-header';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { DefinitionList } from '@/components/data-display/definition-list';
import { useSession } from '@/features/auth/session-provider';
import { useReadiness } from '@/features/system/hooks';
import { API_BASE_URL } from '@/lib/config';
import { formatDateTime } from '@/lib/formatters';
import { roleLabel } from '@/lib/status';
import { applyTheme, readThemePreference, resolveTheme, writeThemePreference, type ThemePreference } from '@/lib/theme';

const THEMES: readonly { id: ThemePreference; label: string; icon: typeof Sun }[] = [
  { id: 'system', label: 'System', icon: Monitor },
  { id: 'light', label: 'Light', icon: Sun },
  { id: 'dark', label: 'Dark', icon: Moon },
];

/**
 * Settings (FDD §7.10).
 *
 * Deliberately narrow: profile, session and display preferences only. Financial
 * policy thresholds, approval rules and security settings are not editable from a
 * generic preference screen — they belong to authorised backend operations.
 */
export default function SettingsPage() {
  const { session, role, canDecide, isAdmin } = useSession();
  const readiness = useReadiness();
  const [theme, setTheme] = useState<ThemePreference>('system');

  useEffect(() => {
    setTheme(readThemePreference());
  }, []);

  const chooseTheme = (next: ThemePreference): void => {
    setTheme(next);
    writeThemePreference(next);
    applyTheme(resolveTheme(next, window.matchMedia('(prefers-color-scheme: dark)').matches));
  };

  const permissions = session
    ? [
        'runs:create',
        'runs:read',
        'runs:cancel',
        'approvals:read',
        'approvals:decide',
        'ledger:read',
        'admin:read',
      ].filter((permission) => holdsPermission(role, permission, canDecide, isAdmin))
    : [];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Settings" description="Profile, session and display preferences. Nothing here changes financial policy." />

      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Profile</CardTitle>
            <Badge tone="info">{role ? roleLabel(role) : 'Unknown role'}</Badge>
          </CardHeader>
          <CardContent>
            {session ? (
              <DefinitionList
                columns={1}
                items={[
                  { term: 'Display name', value: session.displayName },
                  { term: 'Email', value: session.claims.email || '—' },
                  { term: 'Role', value: role ?? '—' },
                  { term: 'Tenant', value: session.claims.tenant_id, mono: true },
                  { term: 'Subject', value: session.claims.sub, mono: true },
                ]}
              />
            ) : (
              <p className="text-sm text-muted">No session is loaded.</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Session</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {session ? (
              <DefinitionList
                columns={1}
                items={[
                  { term: 'Expires', value: formatDateTime(new Date(session.expiresAt)), mono: true },
                  { term: 'Issuer', value: session.claims.iss || '—', mono: true },
                  { term: 'Audience', value: session.claims.aud || '—', mono: true },
                  { term: 'Token type', value: 'Bearer JWT (HS256, verified by the backend)', mono: true },
                  {
                    term: 'Storage',
                    value: 'sessionStorage — discarded when this tab closes; never localStorage',
                  },
                  { term: 'API origin', value: API_BASE_URL, mono: true },
                ]}
              />
            ) : null}
            <Alert tone="warning" role="note" title="Local development credentials">
              This deployment signs in through the backend&apos;s development token endpoint. A production deployment would use an external identity
              provider; the token handling in the browser would be replaced, and the backend would keep authorising every action.
            </Alert>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Permissions your role holds</CardTitle>
            <span className="text-xs text-muted">Informational: the backend enforces these, not this screen.</span>
          </CardHeader>
          <CardContent>
            {permissions.length === 0 ? (
              <p className="text-sm text-muted">No permissions could be derived from the session.</p>
            ) : (
              <ul className="flex flex-wrap gap-2">
                {permissions.map((permission) => (
                  <li key={permission}>
                    <Badge tone="neutral">{permission}</Badge>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Display preferences</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <fieldset className="flex flex-col gap-2">
              <legend className="text-sm font-medium text-foreground">Theme</legend>
              <div className="flex flex-wrap gap-2">
                {THEMES.map((option) => {
                  const Icon = option.icon;
                  const selected = theme === option.id;
                  return (
                    <Button
                      key={option.id}
                      variant={selected ? 'primary' : 'secondary'}
                      size="sm"
                      aria-pressed={selected}
                      onClick={() => chooseTheme(option.id)}
                    >
                      <Icon aria-hidden="true" />
                      {option.label}
                    </Button>
                  );
                })}
              </div>
              <p className="text-xs text-muted">
                The theme is a local display preference. Reduced-motion and contrast preferences are respected from your operating system
                settings.
              </p>
            </fieldset>
          </CardContent>
        </Card>

        <Card className="xl:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Lock aria-hidden="true" className="size-4 text-muted" />
              Not configurable here
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 text-sm text-muted">
            <p>The following are intentionally absent from this screen:</p>
            <ul className="flex list-disc flex-col gap-1 pl-4">
              <li>Refund approval thresholds and any other financial policy value — these are versioned backend configuration.</li>
              <li>Approval expiry windows, tool budgets and execution deadlines.</li>
              <li>Tool permissions available to the agent, and provider credentials. Provider keys never reach the browser.</li>
              <li>User roles and permissions. Changing authorisation from a self-service preference screen would be a privilege-escalation path.</li>
            </ul>
            {readiness.data ? (
              <p className="text-xs">
                Backend readiness: {readiness.data.status} ·{' '}
                {Object.entries(readiness.data.checks)
                  .map(([key, value]) => `${key}: ${value}`)
                  .join(' · ')}
              </p>
            ) : null}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function holdsPermission(role: string | null, permission: string, canDecide: boolean, isAdmin: boolean): boolean {
  if (isAdmin) return true;
  if (permission === 'approvals:decide') return canDecide;
  if (permission === 'admin:read') return false;
  if (role === 'APPROVER') {
    return ['runs:read', 'approvals:read', 'approvals:decide', 'ledger:read'].includes(permission);
  }
  if (role === 'ANALYST') {
    return ['runs:create', 'runs:read', 'runs:cancel', 'approvals:read', 'ledger:read'].includes(permission);
  }
  return false;
}
