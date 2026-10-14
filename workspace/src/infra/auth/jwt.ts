/**
 * Authentication and authorization — PR-01/PR-07, SRS-AUTH-001..005.
 *
 * HMAC-signed JWTs keep the local deployment self-contained while preserving the
 * important property: the tenant, user and role come from a *verified* token, not
 * from a request body, a model argument or a queue message. Swapping in an OIDC
 * issuer means replacing `verifyToken` and nothing else.
 */
import { SignJWT, jwtVerify } from 'jose';
import { AppError, ErrorCode, forbidden } from '../../domain/errors.js';

export type Role = 'ANALYST' | 'APPROVER' | 'ADMIN';

export const PERMISSIONS = [
  'runs:create',
  'runs:read',
  'runs:cancel',
  'approvals:read',
  'approvals:decide',
  'ledger:read',
  'admin:read',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const ROLE_PERMISSIONS: Readonly<Record<Role, readonly Permission[]>> = {
  ANALYST: ['runs:create', 'runs:read', 'runs:cancel', 'approvals:read', 'ledger:read'],
  APPROVER: ['runs:read', 'approvals:read', 'approvals:decide', 'ledger:read'],
  ADMIN: [...PERMISSIONS],
};

export interface AuthPrincipal {
  userId: string;
  subject: string;
  tenantId: string;
  email: string;
  role: Role;
}

export interface AuthConfig {
  jwtSecret: string;
  issuer: string;
  audience: string;
  enableDevTokens: boolean;
}

const CLAIM_TENANT = 'tenant_id';
const CLAIM_EMAIL = 'email';
const CLAIM_ROLE = 'role';

export async function mintToken(principal: AuthPrincipal, config: AuthConfig, expiresInSeconds = 3600): Promise<string> {
  const secret = new TextEncoder().encode(config.jwtSecret);
  return new SignJWT({
    [CLAIM_TENANT]: principal.tenantId,
    [CLAIM_EMAIL]: principal.email,
    [CLAIM_ROLE]: principal.role,
  })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(principal.subject)
    .setIssuer(config.issuer)
    .setAudience(config.audience)
    .setIssuedAt()
    .setExpirationTime(`${expiresInSeconds}s`)
    .sign(secret);
}

export async function verifyToken(token: string, config: AuthConfig): Promise<AuthPrincipal> {
  try {
    const secret = new TextEncoder().encode(config.jwtSecret);
    const { payload } = await jwtVerify(token, secret, {
      issuer: config.issuer,
      audience: config.audience,
    });

    const subject = payload.sub;
    const tenantId = payload[CLAIM_TENANT];
    const email = payload[CLAIM_EMAIL];
    const role = payload[CLAIM_ROLE];

    if (typeof subject !== 'string' || typeof tenantId !== 'string') {
      throw new Error('Token is missing the subject or tenant claim.');
    }

    // The user id must map to a real, active user record; a token alone is never
    // sufficient authority (SRS-AUTH-004).
    return {
      userId: subject,
      subject,
      tenantId,
      email: typeof email === 'string' ? email : '',
      role: isRole(role) ? role : 'ANALYST',
    };
  } catch (error) {
    throw new AppError({
      code: ErrorCode.TOKEN_INVALID,
      message: 'The supplied authentication token is invalid or expired.',
      category: 'AUTHORIZATION',
      httpStatus: 401,
      retryable: false,
      cause: error,
    });
  }
}

export function isRole(value: unknown): value is Role {
  return value === 'ANALYST' || value === 'APPROVER' || value === 'ADMIN';
}

export function permissionsForRole(role: Role): readonly Permission[] {
  return ROLE_PERMISSIONS[role];
}

export function hasPermission(principal: AuthPrincipal, permission: Permission): boolean {
  return permissionsForRole(principal.role).includes(permission);
}

export function assertPermission(principal: AuthPrincipal, permission: Permission): void {
  if (!hasPermission(principal, permission)) {
    throw forbidden(`The ${principal.role} role does not hold the ${permission} permission.`);
  }
}

export function extractBearerToken(header: string | undefined): string | null {
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match?.[1]?.trim() ?? null;
}
