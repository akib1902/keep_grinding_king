import { apiGet } from '@/lib/api-client';
import { ledgerOperationSchema } from '@/lib/schemas';
import type { LedgerOperation } from '@/types/api';

/**
 * Settlement operations are addressed by operation id. The ledger view builds its
 * rows from run history and loads the operation detail only for rows the user
 * actually opens, so the console never presents more than the backend confirms.
 */
export async function getLedgerOperation(operationId: string, signal?: AbortSignal): Promise<LedgerOperation> {
  return apiGet<LedgerOperation>(`/api/ledger/operations/${operationId}`, { signal }, {
    parse: (value) => ledgerOperationSchema.parse(value) as LedgerOperation,
  });
}
