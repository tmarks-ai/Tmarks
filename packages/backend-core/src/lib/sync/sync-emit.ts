import type { SyncEntityType, SyncOperationType } from '@tmarks/contracts'
import { generateUUID } from '../crypto'
import { chunkForD1In } from '../d1-chunk'
import { recordEntityRevision, recordSyncChange } from './sync-repository'
import { createRevision } from './sync-utils'

/**
 * Device id attributed to changes made through the REST API (web app, API keys)
 * rather than the extension's sync push. Pull does not filter by device, so this
 * is purely for provenance in `sync_changes`.
 */
export const REST_SYNC_DEVICE_ID = 'rest-api'

/**
 * Entities whose revision lives in a column on their own table. Everything else
 * tracks revisions in `sync_entity_revisions`.
 */
const REVISION_COLUMN_TABLES: Partial<Record<SyncEntityType, string>> = {
  bookmark: 'bookmarks',
  tab_group: 'tab_groups',
}

/**
 * Stamps every item of a tab group with the group's revision.
 *
 * Tab group items are carried inside their group's sync payload, so when a
 * group-level change lands the client stores the *group's* revision as each
 * item's base_revision. Unless the server agrees, the next item-level push
 * compares that against a stale item revision and raises a spurious
 * `revision_mismatch` — a conflict dialog for the user's own sequential edits.
 *
 * The invariant this maintains: an item's revision is whatever revision last
 * touched it, whether that came from an item-level or a group-level operation.
 */
export async function recordGroupItemRevisions(
  db: D1Database,
  userId: string,
  groupId: string,
  revision: string,
  now: string
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO sync_entity_revisions (user_id, entity_type, entity_id, revision, updated_at)
       SELECT ?, 'tab_group_item', id, ?, ? FROM tab_group_items WHERE group_id = ?
       ON CONFLICT(user_id, entity_type, entity_id)
       DO UPDATE SET revision = excluded.revision, updated_at = excluded.updated_at`
    )
    .bind(userId, revision, now, groupId)
    .run()
}

/**
 * Records a sync change for a mutation performed outside the sync push path.
 *
 * Without this, REST writes are invisible to the extension's incremental pull:
 * it would only converge on the next 24h bootstrap, and a delete made on the
 * web could be silently undone by a stale extension push (the revision would
 * still match, so no conflict was raised).
 *
 * Bumping the revision is the load-bearing half — it is what makes the next
 * push from a stale device raise a conflict instead of overwriting.
 */
export async function emitSyncChange(
  db: D1Database,
  userId: string,
  entityType: SyncEntityType,
  entityId: string,
  operation: SyncOperationType
): Promise<void> {
  const revision = createRevision()
  const now = new Date().toISOString()

  const table = REVISION_COLUMN_TABLES[entityType]
  if (table) {
    await db
      .prepare(`UPDATE ${table} SET revision = ? WHERE id = ? AND user_id = ?`)
      .bind(revision, entityId, userId)
      .run()
  } else {
    await recordEntityRevision(db, userId, entityType, entityId, revision, now)
  }

  // The group payload carries its items, so the client stamps them with this
  // revision too; keep the server side in step.
  if (entityType === 'tab_group') {
    await recordGroupItemRevisions(db, userId, entityId, revision, now)
  }

  await recordSyncChange(db, userId, REST_SYNC_DEVICE_ID, entityType, entityId, operation, revision)
}

/**
 * Batch variant.
 *
 * The sequential loop cost 4-5 D1 round trips per entity (revision UPDATE +
 * payload read-back + change INSERT): emptying a 500-item trash fired ~2,000
 * sequential queries after the delete itself had already run in one batch.
 *
 * Bookmarks — the only type bulk callers actually use today (empty-trash,
 * bulk, batch import) — get a fast path: one IN read for rows, one IN read
 * for tags, then a single db.batch with all revision UPDATEs + change INSERTs.
 * The payload is byte-identical to loadServerPayload's shape. Other types
 * (and single-entity calls) keep the sequential path.
 */
export async function emitSyncChanges(
  db: D1Database,
  userId: string,
  entityType: SyncEntityType,
  entityIds: string[],
  operation: SyncOperationType
): Promise<void> {
  if (entityIds.length === 0) return
  if (entityType !== 'bookmark' || entityIds.length === 1) {
    for (const entityId of entityIds) {
      await emitSyncChange(db, userId, entityType, entityId, operation)
    }
    return
  }

  const now = new Date().toISOString()

  // D1 caps bound parameters at 100 per query; emptyTrash calls this with the
  // full trash (unbounded), and a >99-id IN here used to throw AFTER the delete
  // batch had committed — the delete tombstones were then silently lost until
  // the next 24h bootstrap. Chunk the reads; the per-entity statements below
  // each bind only 3-4 params.
  const rowById = new Map<string, Record<string, unknown>>()
  for (const chunk of chunkForD1In(entityIds, 1)) {
    const placeholders = chunk.map(() => '?').join(',')
    const { results } = await db
      .prepare(
        `SELECT id, title, url, description, folder_id, cover_image, favicon, is_pinned,
                pin_order, is_todo, is_archived, is_private, position,
                click_count, last_clicked_at, revision, created_at, updated_at, deleted_at
         FROM bookmarks
         WHERE id IN (${placeholders}) AND user_id = ?`
      )
      .bind(...chunk, userId)
      .all<Record<string, unknown>>()
    for (const row of results || []) rowById.set(row.id as string, row)
  }

  const tagsByBookmark = new Map<string, Array<{ id: string; name: string; color: string | null }>>()
  for (const chunk of chunkForD1In(entityIds, 1)) {
    const placeholders = chunk.map(() => '?').join(',')
    const { results: tagRows } = await db
      .prepare(
        `SELECT bt.bookmark_id, t.id, t.name, t.color
         FROM tags t
         JOIN bookmark_tags bt ON bt.tag_id = t.id
         WHERE bt.bookmark_id IN (${placeholders}) AND bt.user_id = ? AND t.deleted_at IS NULL
         ORDER BY t.name ASC`
      )
      .bind(...chunk, userId)
      .all<{ bookmark_id: string; id: string; name: string; color: string | null }>()
    for (const row of tagRows || []) {
      const list = tagsByBookmark.get(row.bookmark_id) || []
      list.push({ id: row.id, name: row.name, color: row.color })
      tagsByBookmark.set(row.bookmark_id, list)
    }
  }

  const statements: D1PreparedStatement[] = []
  for (const entityId of entityIds) {
    const revision = createRevision()
    statements.push(
      db.prepare('UPDATE bookmarks SET revision = ? WHERE id = ? AND user_id = ?')
        .bind(revision, entityId, userId)
    )
    const row = rowById.get(entityId)
    // Missing row (hard-deleted) mirrors loadServerPayload's null payload. The
    // embedded revision must be the NEW one: the sequential path re-reads the
    // row after the revision UPDATE already landed.
    const payload = row ? { ...row, revision, tags: tagsByBookmark.get(entityId) || [] } : null
    statements.push(
      db.prepare(
        `INSERT INTO sync_changes
         (change_id, user_id, device_id, entity_type, entity_id, operation, revision, payload_json, changed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
        .bind(
          generateUUID(),
          userId,
          REST_SYNC_DEVICE_ID,
          entityType,
          entityId,
          operation,
          revision,
          JSON.stringify(payload),
          now
        )
    )
  }
  await db.batch(statements)
}
