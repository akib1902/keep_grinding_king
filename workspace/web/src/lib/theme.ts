/**
 * Theme preference (FDD §7.10, §8.2).
 *
 * The preference is a display setting only, never a policy or security setting.
 * It is applied to `<html class="dark">` and stored locally.
 */
export type ThemePreference = 'light' | 'dark' | 'system';

const STORAGE_KEY = 'ledgerflow.theme';

export const THEME_STORAGE_KEY = STORAGE_KEY;

export function isThemePreference(value: unknown): value is ThemePreference {
  return value === 'light' || value === 'dark' || value === 'system';
}

export function readThemePreference(): ThemePreference {
  if (typeof window === 'undefined') return 'system';
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return isThemePreference(stored) ? stored : 'system';
  } catch {
    return 'system';
  }
}

export function writeThemePreference(preference: ThemePreference): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, preference);
  } catch {
    // A blocked storage area must not break the page; the theme still applies.
  }
}

export function resolveTheme(preference: ThemePreference, prefersDark: boolean): 'light' | 'dark' {
  if (preference === 'system') return prefersDark ? 'dark' : 'light';
  return preference;
}

export function applyTheme(resolved: 'light' | 'dark'): void {
  if (typeof document === 'undefined') return;
  document.documentElement.classList.toggle('dark', resolved === 'dark');
}

/**
 * Inline script run before paint so a dark-theme user never sees a light flash.
 * Kept dependency-free because it executes before any bundle is parsed.
 */
export const THEME_INIT_SCRIPT = `(function(){try{var p=localStorage.getItem('${STORAGE_KEY}')||'system';var m=window.matchMedia('(prefers-color-scheme: dark)').matches;var d=p==='dark'||(p==='system'&&m);document.documentElement.classList.toggle('dark',d);}catch(e){}})();`;
