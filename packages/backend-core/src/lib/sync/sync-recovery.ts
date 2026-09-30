import type { SyncEnvelope } from '@tmarks/contracts'
import type { IdempotencyClaim } from './sync-idempotency'

type ApplyClaim = Extract<IdempotencyClaim, { kind: 'apply' }>

function isApplyClaim(claim: IdempotencyClaim): claim is ApplyClaim {
  return claim.kind === 'apply'
}

/**
 * Recovers the idempotency table after a push throws part-way through.
 *
 * Two things must happen, and getting either wrong is a data bug:
 *
 * - Operations that already completed keep their stored response. Releasing
 *   them made every retry re-apply work that had landed (re-creating tags,
 *   re-inserting tab group items) while the client never saw an acceptance.
 * - Operations that never ran must have their placeholder released. An empty
 *   placeholder (`response_json = ''`) otherwise wedges every retry with
 *   IDEMPOTENCY_IN_PROGRESS for the full 14-day TTL.
 *
 * The `response_json = ''` predicate on the delete also leaves completed
 * responses written by a concurrent push untouched.
 */
export async function recoverIdempotencyAfterFailure(
  db: D1Database,
  userId: string,
  claims: IdempotencyClaim[],
  settled: Set<string>,
  storeStatements: D1PreparedStatement[]
): Promise<void> {
  const releases = claims
    .filter((claim): claim is ApplyClaim => isApplyClaim(claim) && !settled.has(claim.operation.client_operation_id))
    .map((claim) =>
      db
        .prepare('DELETE FROM sync_idempotency_keys WHERE user_id = ? AND client_operation_id = ? AND response_json = ?')
        .bind(userId, claim.operation.client_operation_id, '')
    )

  const recovery = [...storeStatements, ...releases]
  // D1 rejects an empty batch, which would mask the original error.
  if (recovery.length > 0) await db.batch(recovery)
}

/**
 * Whether an upsert would silently revive a row that was deleted elsewhere.
 *
 * Scoped to matches on the entity's own id: when the server row was matched by
 * URL or name instead, it belongs to a different local entity, which means the
 * user is re-saving a trashed page — that should revive it, not raise a
 * conflict. A client that already knows about the deletion carries the matching
 * base_revision (an explicit restore); anything else, including a client that
 * never synced this row and so sends a null base_revision, is a real conflict.
 */
export function isResurrectingDeletedEntity(
  operation: SyncEnvelope,
  existing: { id: string; revision?: string | null } | null,
  deleted: boolean
): boolean {
  if (!existing || !deleted) return false
  if (existing.id !== operation.entity_id) return false
  if (operation.operation === 'delete') return false
  return !operation.base_revision || operation.base_revision !== existing.revision
}
