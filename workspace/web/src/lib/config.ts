/**
 * Frontend runtime configuration.
 *
 * The API origin is public configuration, never a secret: it is the backend the
 * browser is allowed to talk to. Credentials live in session storage only.
 */
export const API_BASE_URL: string = (process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://127.0.0.1:3100').replace(
  /\/+$/,
  '',
);

/** Default role offered first on the login screen. */
export const DEFAULT_ROLE = process.env.NEXT_PUBLIC_DEFAULT_ROLE ?? 'ANALYST';

/** How often a connected SSE run view is allowed to trigger an authoritative refetch. */
export const REFETCH_MIN_INTERVAL_MS = 2_000;

/** Approval requests close to expiry are highlighted as stale (FDD §7.6). */
export const APPROVAL_STALE_WINDOW_MS = 10 * 60 * 1000;
