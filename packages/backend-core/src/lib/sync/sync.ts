import type {
  SyncAcceptedOperation,
  SyncChange,
  SyncConflictDTO,
  SyncEnvelope,
  SyncPushResponse,
  SyncRejectedOperation,
} from '@tmarks/contracts'
import type { SyncChangeRow } from './sync-types'
import { decodeCursor, encodeCursor, reject, rowToChange } from './sync-utils'
import { applySyncOperation } from './sync-apply'
import { getLatestSyncCursor } from './sync-cursor'
import { buildStoreStatement, claimIdempotency, type IdempotencyClaim } from './sync-idempotency'
import { recoverIdempotencyAfterFailure } from './sync-recovery'
import { maybeCompactSyncChanges } from './sync-retention'
export { bootstrapSyncChanges } from './sync-bootstrap'
export { getLatestSyncCursor } from './sync-cursor'

export { decodeCursor, encodeCursor } from './sync-utils'

export async function listSyncChanges(
  db: D1Database,
  userId: string,
  cursor: string | null,
  limit = 100
): Promise<{ changes: SyncChange[]; cursor: string; has_more: boolean }> {
  const afterId = decodeCursor(cursor)
  const pageSize = Math.max(1, Math.min(limit, 200))
  const { results } = await db
    .prepare(
      `SELECT id, change_id, entity_type, entity_id, operation, revision, payload_json, changed_at
       FROM sync_changes
       WHERE user_id = ? AND id > ?
       ORDER BY id ASC
       LIMIT ?`
    )
    .bind(userId, afterId, pageSize + 1)
    .all<SyncChangeRow>()

  const rows = results ?? []
  const hasMore = rows.length > pageSize
  const visibleRows = hasMore ? rows.slice(0, pageSize) : rows
  const lastId = visibleRows.length > 0 ? visibleRows[visibleRows.length - 1].id : afterId

  return {
    changes: visibleRows.map(rowToChange),
    cursor: encodeCursor(lastId),
    has_more: hasMore,
  }
}

async function registerSyncDevice(db: D1Database, userId: string, deviceId: string): Promise<void> {
  await db
    .prepare(
      `INSERT INTO sync_devices (id, user_id, last_seen_at)
       VALUES (?, ?, ?)
       ON CONFLICT(user_id, id)
       DO UPDATE SET last_seen_at = ?`
    )
    .bind(deviceId, userId, new Date().toISOString(), new Date().toISOString())
    .run()
}

export async function pushSyncOperations(
  db: D1Database,
  userId: string,
  deviceId: string,
  operations: SyncEnvelope[]
): Promise<SyncPushResponse> {
  const accepted: SyncAcceptedOperation[] = []
  const conflicts: SyncConflictDTO[] = []
  const rejected: SyncRejectedOperation[] = []

  await registerSyncDevice(db, userId, deviceId)

  // applySyncOperation interleaves reads+writes (tag resolution, IDOR guards)
  // and db.batch() gives no per-statement rows, so full statement collection
  // would break read-your-writes. We atomically claim idempotency rows up
  // front instead; a crash leaves a placeholder the client can observe.
  const claims: IdempotencyClaim[] = []
  for (const operation of operations) {
    claims.push(await claimIdempotency(db, userId, operation))
  }

  const storeStatements: D1PreparedStatement[] = []
  // Client operation ids whose result is already captured in storeStatements.
  // On a mid-push throw these must be persisted rather than released: releasing
  // them made every retry re-apply work that had already landed (re-creating
  // tags, re-inserting tab group items) while the client never saw acceptance.
  const settled = new Set<string>()
  try {
    for (let index = 0; index < operations.length; index++) {
      const claim = claims[index]
      if (!claim) continue
      if (claim.kind === 'replay') {
        if (claim.response.type === 'accepted') accepted.push(claim.response.value)
        if (claim.response.type === 'conflict') conflicts.push(claim.response.value)
        if (claim.response.type === 'rejected') rejected.push(claim.response.value)
        continue
      }
      if (claim.kind === 'mismatch') {
        rejected.push(reject(claim.operation, 'IDEMPOTENCY_CONFLICT', 'The same client operation id was used with a different payload.'))
        continue
      }

      const result = await applySyncOperation(db, userId, deviceId, claim.operation)

      if (result.type === 'accepted') accepted.push(result.value)
      if (result.type === 'conflict') conflicts.push(result.value)
      if (result.type === 'rejected') rejected.push(result.value)

      storeStatements.push(buildStoreStatement(db, userId, claim.operation.client_operation_id, claim.requestHash, result))
      settled.add(claim.operation.client_operation_id)
    }

    // Batch-persist idempotency responses so placeholders complete atomically.
    // Keep this inside the recovery boundary: if a business write has already
    // landed but the response batch fails, releasing the claim would re-apply
    // the same operation on the client's next retry.
    if (storeStatements.length > 0) {
      await db.batch(storeStatements)
    }
  } catch (error) {
    await recoverIdempotencyAfterFailure(db, userId, claims, settled, storeStatements)
    throw error
  }

  await maybeCompactSyncChanges(db, userId)

  return {
    accepted,
    conflicts,
    rejected,
    cursor: await getLatestSyncCursor(db, userId),
  }
}
