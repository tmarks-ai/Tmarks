import type { SyncIdempotencyRow } from './sync-d1-types'
import { idempotencyKey } from './sync-d1-utils'

/**
 * Idempotency side-store extracted from sync-d1-memory.ts so the mock database
 * stays under the ≤300-line budget. Both operations share the `idempotency`
 * Map on the parent class, so composability stays trivial.
 */
export function claimIdempotency(
  idempotency: Map<string, SyncIdempotencyRow>,
  values: unknown[],
): { success: true; meta: { changes: 0 | 1 } } {
  const userId = String(values[0])
  const clientOperationId = String(values[1])
  const key = idempotencyKey(userId, clientOperationId)

  if (idempotency.has(key)) {
    return { success: true, meta: { changes: 0 } }
  }

  // Placeholder: response_json starts as '' so callers distinguish "in-progress"
  // from "final". The subsequent INSERT OR REPLACE (buildStoreStatement) fills it.
  const row: SyncIdempotencyRow = {
    user_id: userId,
    client_operation_id: clientOperationId,
    request_hash: String(values[2]),
    response_json: '',
    expires_at: String(values[4]),
  }
  idempotency.set(key, row)
  return { success: true, meta: { changes: 1 } }
}

export function insertIdempotency(
  idempotency: Map<string, SyncIdempotencyRow>,
  values: unknown[],
): { success: true } {
  const row: SyncIdempotencyRow = {
    user_id: String(values[0]),
    client_operation_id: String(values[1]),
    request_hash: String(values[2]),
    response_json: String(values[3]),
    expires_at: String(values[4]),
  }
  idempotency.set(idempotencyKey(row.user_id, row.client_operation_id), row)
  return { success: true }
}
