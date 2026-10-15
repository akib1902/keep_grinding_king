/**
 * Session storage (FDD §12.1).
 *
 * The backend issues short-lived bearer tokens (1 hour) through
 * `POST /api/auth/dev-token` in local development. There is no cookie-based
 * option on this API, so the token is held in `sessionStorage`: it is scoped to
 * the tab and discarded when the tab closes, which is deliberately weaker than
 * `localStorage` but stronger than a long-lived credential in persistent storage.
 *
 * The client never verifies the signature — that is the backend's job — but it
 * does read the claims to render the signed-in identity and to stop sending a
 * token that has already expired.
 */
import type { Role, SessionClaims } from '@/types/api';

const STORAGE_KEY = 'ledgerflow.session';

export interface Session {
  token: string;
  /** Epoch milliseconds at which the token stops being valid. */
  expiresAt: number;
  claims: SessionClaims;
  /** Display name resolved at sign-in; the API does not return one in the token. */
  displayName: string;
}

type Listener = () => void;

let current: Session | null = null;
let loaded = false;
const listeners = new Set<Listener>();

function isBrowser(): boolean {
  return typeof window !== 'undefined';
}

/** Decodes the payload of a JWT without verifying it. Returns null when malformed. */
export function decodeClaims(token: string): SessionClaims | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const payload = parts[1];
  if (!payload) return null;
  try {
    const normalized = payload.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), '=');
    const decoded = isBrowser() ? atob(padded) : Buffer.from(padded, 'base64').toString('binary');
    const json = JSON.parse(decoded) as Partial<SessionClaims>;
    if (typeof json.sub !== 'string' || typeof json.tenant_id !== 'string' || typeof json.exp !== 'number') return null;
    return {
      sub: json.sub,
      tenant_id: json.tenant_id,
      email: typeof json.email === 'string' ? json.email : '',
      role: (json.role as Role) ?? 'ANALYST',
      iss: typeof json.iss === 'string' ? json.iss : '',
      aud: typeof json.aud === 'string' ? json.aud : '',
      iat: typeof json.iat === 'number' ? json.iat : 0,
      exp: json.exp,
    };
  } catch {
    return null;
  }
}

export function isExpired(session: Pick<Session, 'expiresAt'>, now: number = Date.now()): boolean {
  return session.expiresAt <= now;
}

function parseStored(raw: string): Session | null {
  try {
    const parsed = JSON.parse(raw) as Partial<Session>;
    if (typeof parsed.token !== 'string' || typeof parsed.expiresAt !== 'number') return null;
    const claims = decodeClaims(parsed.token);
    if (!claims) return null;
    return {
      token: parsed.token,
      expiresAt: parsed.expiresAt,
      claims,
      displayName: typeof parsed.displayName === 'string' ? parsed.displayName : claims.email,
    };
  } catch {
    return null;
  }
}

/** Loads the session once per page load, dropping an expired one. */
export function loadSession(): Session | null {
  if (loaded) return current;
  loaded = true;
  if (!isBrowser()) return null;
  const raw = window.sessionStorage.getItem(STORAGE_KEY);
  if (raw) {
    const parsed = parseStored(raw);
    current = parsed && !isExpired(parsed) ? parsed : null;
    if (raw && !current) window.sessionStorage.removeItem(STORAGE_KEY);
  }
  return current;
}

export function getSession(): Session | null {
  return loaded ? current : loadSession();
}

export function setSession(session: Session): void {
  current = session;
  loaded = true;
  if (isBrowser()) {
    try {
      window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(session));
    } catch {
      // Storage can be unavailable (private mode quota); the in-memory session
      // still works for this page's lifetime.
    }
  }
  emit();
}

export function clearSession(): void {
  current = null;
  loaded = true;
  if (isBrowser()) {
    try {
      window.sessionStorage.removeItem(STORAGE_KEY);
    } catch {
      // Ignore: nothing to clean up if storage is unavailable.
    }
  }
  emit();
}

/** The token to attach to a request, or null when there is none usable. */
export function getActiveToken(now: number = Date.now()): string | null {
  const session = getSession();
  if (!session) return null;
  if (isExpired(session, now)) {
    clearSession();
    return null;
  }
  return session.token;
}

export function subscribeSession(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function emit(): void {
  for (const listener of listeners) listener();
}

/** Test seam: resets the module's memoised state. */
export function resetSessionForTests(): void {
  current = null;
  loaded = false;
  listeners.clear();
}

export function roleFromSession(session: Session | null): Role | null {
  return session?.claims.role ?? null;
}

/** Whether the signed-in role may act as an approver (FDD §12.2). */
export function canDecide(session: Session | null): boolean {
  return session?.claims.role === 'APPROVER' || session?.claims.role === 'ADMIN';
}
