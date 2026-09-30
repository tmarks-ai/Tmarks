import type { SyncAcceptedOperation, SyncConflictDTO, SyncEnvelope, SyncRejectedOperation } from '@tmarks/contracts'
import type { StoredIdempotencyRow } from './sync-types'
import { hashOperation, reject } from './sync-utils'

type IdempotencyStoredResponse =
  | { type: 'accepted'; value: SyncAcceptedOperation }
  | { type: 'conflict'; value: SyncConflictDTO }
  | { type: 'rejected'; value: SyncRejectedOperation }

export type IdempotencyClaim =
  | { kind: 'apply'; operation: SyncEnvelope; requestHash: string }
  | { kind: 'replay'; response: IdempotencyStoredResponse }
  | { kind: 'mismatch'; operation: SyncEnvelope }

// Concurrency guard: PK (user_id, client_operation_id) means INSERT ...
// ON CONFLICT DO NOTHING + meta.changes tells us whether this request is the
// first to claim the operation. Prevents double-applied side effects under
// concurrent identical pushes that plain SELECT-then-INSERT would allow.
export async function claimIdempotency(
  db: D1Database,
  userId: string,
  operation: SyncEnvelope
): Promise<IdempotencyClaim> {
  const requestHash = await hashOperation(operation)
  const expiresAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString()

  // Probabilistic TTL sweep: ~5% of claims also purge expired rows so the
  // 14-day expires_at is actually enforced (D1 has no scheduled cleanup).
  if (Math.random() < 0.05) {
    await db
      .prepare('DELETE FROM sync_idempotency_keys WHERE expires_at < ?')
      .bind(new Date().toISOString())
      .run()
  }

  const claim = await db
    .prepare(
      `INSERT INTO sync_idempotency_keys
       (user_id, client_operation_id, request_hash, response_json, expires_at)
       VALUES (?, ?, ?, '', ?)
       ON CONFLICT(user_id, client_operation_id) DO NOTHING`
    )
    .bind(userId, operation.client_operation_id, requestHash, expiresAt)
    .run()

  // Real D1 always reports meta.changes; fall back to "not claimed" when a
  // driver omits it so we take the read-back path instead of double-applying.
  if ((claim.meta?.changes ?? 0) === 1) {
    return { kind: 'apply', operation, requestHash }
  }

  const stored = await db
    .prepare(
      `SELECT request_hash, response_json, expires_at
       FROM sync_idempotency_keys
       WHERE user_id = ? AND client_operation_id = ?`
    )
    .bind(userId, operation.client_operation_id)
    .first<StoredIdempotencyRow>()

  if (stored) {
    if (stored.request_hash !== requestHash) {
      return { kind: 'mismatch', operation }
    }
    // Placeholder claimed by a concurrent push, response not yet persisted:
    // refuse to re-apply side effects.
    if (!stored.response_json) {
      return {
        kind: 'replay',
        response: {
          type: 'rejected',
          value: reject(operation, 'IDEMPOTENCY_IN_PROGRESS', 'This operation is being processed by another concurrent push.'),
        },
      }
    }
    return { kind: 'replay', response: JSON.parse(stored.response_json) as IdempotencyStoredResponse }
  }

  // Rare race: insert did not land and row is already gone. Apply anyway; the
  // batch persist step below still records the response.
  return { kind: 'apply', operation, requestHash }
}

export function buildStoreStatement(
  db: D1Database,
  userId: string,
  clientOperationId: string,
  requestHash: string,
  response: { type: string; value: unknown }
): D1PreparedStatement {
  const expiresAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString()
  // ON CONFLICT DO UPDATE, not INSERT OR REPLACE: SQLite's REPLACE is
  // DELETE+INSERT and D1 bills both written rows — every pushed operation
  // paid an extra row for its own idempotency record.
  return db
    .prepare(
      `INSERT INTO sync_idempotency_keys
       (user_id, client_operation_id, request_hash, response_json, expires_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(user_id, client_operation_id) DO UPDATE SET
         request_hash = excluded.request_hash,
         response_json = excluded.response_json,
         expires_at = excluded.expires_at`
    )
    .bind(userId, clientOperationId, requestHash, JSON.stringify(response), expiresAt)
}
