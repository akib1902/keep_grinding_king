/**
 * Authentication calls (FDD §12).
 *
 * The MVP uses the backend's local development token endpoint. Swapping this
 * single module for a real OIDC authorization-code exchange changes nothing else
 * in the console, because every other call goes through the same `Authorization`
 * header.
 */
import { apiPost } from '@/lib/api-client';
import { tokenResponseSchema } from '@/lib/schemas';
import type { Role, TokenResponse } from '@/types/api';

export interface SignInInput {
  role: Role;
  email: string;
  name?: string;
  tenantId?: string;
}

export async function requestDevToken(input: SignInInput): Promise<TokenResponse> {
  return apiPost<TokenResponse>(
    '/api/auth/dev-token',
    {
      role: input.role,
      email: input.email,
      ...(input.name ? { name: input.name } : {}),
      ...(input.tenantId ? { tenantId: input.tenantId } : {}),
    },
    { token: null },
    {
      parse: (value) => tokenResponseSchema.parse(value) as TokenResponse,
    },
  );
}
