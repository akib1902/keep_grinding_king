import { apiGet } from '@/lib/api-client';
import { readinessSchema } from '@/lib/schemas';
import type { ReadinessResponse } from '@/types/api';

/** `GET /health/ready` is public; it powers the header's service indicator. */
export async function getReadiness(signal?: AbortSignal): Promise<ReadinessResponse> {
  return apiGet<ReadinessResponse>('/health/ready', { token: null, signal, timeoutMs: 5_000 }, {
    parse: (value) => readinessSchema.parse(value) as ReadinessResponse,
  });
}
