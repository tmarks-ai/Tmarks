/**
 * Retention for the sync bookkeeping tables.
 *
 * None of them had pruning of any kind. This module bounds them, hooked into
 * ~5% of pushes (D1 cannot run retention at write time for every op; the
 * storage-cleanup outbox now also has an hourly scheduled drain for R2 keys,
 * but this probabilistic sweep stays — it runs on the hot path where the
 * tables are written), mirroring the idempotency TTL sweep:
 *
 * - `sync_changes`: compaction. Change payloads are full state snapshots rather
 *   than diffs, so for any entity only the newest row matters, and a client
 *   sitting at any cursor still converges to the same state from it. That makes
 *   this safe with no watermark tracking and no "your cursor is too old,
 *   re-bootstrap" protocol. Bounded by entity count instead of edit count.
 *
 * - `sync_entity_revisions`: tab group items are hard-deleted in several places
 *   (single delete, group replace, dedup, permanent group delete) while their
 *   revision rows live in this separate table — orphaned forever. Sweeping the
 *   orphans is invisible to behaviour: getExistingEntity joins the items table
 *   first and returns null when the row is gone, and any recreate re-establishes
 *   the revision. Folders and tags are soft-deleted only, so their rows are
 *   never orphans; bookmarks and groups keep their revision in their own table
 *   row, which dies with it.
 *
 * - `sync_devices`: written on every push, read by nothing. A reinstall
 *   generates a fresh device id and the old row would linger forever.
 */

/** Rows younger than this are never touched, leaving in-flight pulls alone. */
const COMPACTION_GRACE_MS = 60 * 60 * 1000

/** Devices silent for this long are considered gone. */
const DEVICE_STALENESS_MS = 90 * 24 * 60 * 60 * 1000

/** Share of pushes that also run a retention pass. */
const COMPACTION_SAMPLE_RATE = 0.05

/**
 * Deletes every `sync_changes` row that a newer row for the same entity already
 * supersedes. Returns the number of rows removed.
 */
export async function compactSyncChanges(db: D1Database, userId: string): Promise<number> {
  const cutoff = new Date(Date.now() - COMPACTION_GRACE_MS).toISOString()
  const result = await db
    .prepare(
      `DELETE FROM sync_changes
       WHERE user_id = ?
         AND changed_at < ?
         AND id NOT IN (
           SELECT MAX(id) FROM sync_changes
           WHERE user_id = ?
           GROUP BY entity_type, entity_id
         )`
    )
    .bind(userId, cutoff, userId)
    .run()
  return Number(result?.meta?.changes ?? 0)
}

/**
 * Removes revision rows for tab group items that no longer exist. Set-based, so
 * it covers every deletion path — including future ones — without each call
 * site having to remember. Entity ids are global primary keys, which makes the
 * membership test precise without scoping by user.
 */
export async function sweepOrphanedItemRevisions(db: D1Database): Promise<number> {
  const result = await db
    .prepare(
      `DELETE FROM sync_entity_revisions
       WHERE entity_type = 'tab_group_item'
         AND entity_id NOT IN (SELECT id FROM tab_group_items)`
    )
    .run()
  return Number(result?.meta?.changes ?? 0)
}

/** Drops device rows nobody has heard from in a long while. */
export async function pruneStaleSyncDevices(db: D1Database): Promise<number> {
  const result = await db
    // NULL last_seen means the device never completed a push — SQL NULL
    // semantics would otherwise exclude it from the comparison forever.
    .prepare('DELETE FROM sync_devices WHERE last_seen_at IS NULL OR last_seen_at < ?')
    .bind(new Date(Date.now() - DEVICE_STALENESS_MS).toISOString())
    .run()
  return Number(result?.meta?.changes ?? 0)
}

/** Probabilistic hook for the push path, mirroring the idempotency TTL sweep. */
export async function maybeCompactSyncChanges(db: D1Database, userId: string): Promise<void> {
  if (Math.random() >= COMPACTION_SAMPLE_RATE) return
  await compactSyncChanges(db, userId)
  await sweepOrphanedItemRevisions(db)
  await pruneStaleSyncDevices(db)
}
