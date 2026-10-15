'use client';

import { useEffect, useState } from 'react';
import { Monitor, Moon, Sun } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { applyTheme, readThemePreference, resolveTheme, writeThemePreference, type ThemePreference } from '@/lib/theme';

const ORDER: readonly ThemePreference[] = ['system', 'light', 'dark'];
const LABEL: Record<ThemePreference, string> = { system: 'System theme', light: 'Light theme', dark: 'Dark theme' };
const ICON = { system: Monitor, light: Sun, dark: Moon } as const;

/**
 * Display preference only (FDD §7.10). It is applied to the document element and
 * remembered locally; it never affects policy or security behaviour.
 */
export function ThemeToggle() {
  const [preference, setPreference] = useState<ThemePreference>('system');

  useEffect(() => {
    const stored = readThemePreference();
    setPreference(stored);
    applyTheme(resolveTheme(stored, window.matchMedia('(prefers-color-scheme: dark)').matches));
  }, []);

  const cycle = (): void => {
    const index = ORDER.indexOf(preference);
    const next = ORDER[(index + 1) % ORDER.length] as ThemePreference;
    setPreference(next);
    writeThemePreference(next);
    applyTheme(resolveTheme(next, window.matchMedia('(prefers-color-scheme: dark)').matches));
  };

  const Icon = ICON[preference];
  return (
    <Button variant="ghost" size="icon" onClick={cycle} aria-label={`${LABEL[preference]} — switch theme`}>
      <Icon aria-hidden="true" />
    </Button>
  );
}
