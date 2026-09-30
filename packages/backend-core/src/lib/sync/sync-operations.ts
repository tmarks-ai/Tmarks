import type { SyncOperationType } from '@tmarks/contracts'
import { generateUUID } from '../crypto'
import { chunkForD1In } from '../d1-chunk'
import type {
  BookmarkSyncPayload,
  SyncApplyResult,
} from './sync-types'
import {
  createRevision,
  toBooleanInt,
  uniqueStrings,
  clampText,
} from './sync-utils'
import { normalizeBookmarkUrl } from '../bookmarks/bookmark-url'
export { applyBookmarkFolderOperation } from './sync-folders'
export { applyTabGroupOperation } from './sync-tab-groups'
export { applyTabGroupItemOperation, validateTabGroupItemPayload } from './sync-tab-group-items'
export { applyPreferenceOperation, applyTagOperation } from './sync-tags-preferences'

export type { SyncApplyResult } from './sync-types'

export async function applyBookmarkOperation(
  db: D1Database,
  userId: string,
  entityId: string,
  revision: string,
  now: string,
  payload: BookmarkSyncPayload,
  operation: SyncOperationType
): Promise<SyncApplyResult> {
  if (operation === 'delete') {
    await db
      .prepare('UPDATE bookmarks SET deleted_at = ?, revision = ?, updated_at = ? WHERE id = ? AND user_id = ?')
      .bind(now, revision, now, entityId, userId)
      .run()
    return { ok: true }
  }

  // Guard cross-user IDOR: global PK, so bail when owned by another account.
  // user_id doubles as the ownership guard; the extra columns are preserved
  // by ON CONFLICT DO UPDATE (not in its SET list) and feed the sync payload
  // below without a re-read.
  const owner = await db
    .prepare('SELECT user_id, created_at, click_count, last_clicked_at FROM bookmarks WHERE id = ?')
    .bind(entityId)
    .first<{ user_id: string; created_at: string; click_count: number; last_clicked_at: string | null }>()
  if (owner && owner.user_id !== userId) {
    return { ok: false, reason: 'The entity id belongs to a different account.' }
  }
  if (payload.folder_id) {
    const folder = await db
      .prepare('SELECT id FROM bookmark_folders WHERE id = ? AND user_id = ?')
      .bind(payload.folder_id, userId)
      .first<{ id: string }>()
    if (!folder) return { ok: false, reason: 'The parent folder was not found for this account.' }
  }

  // REST 同口径存储上限(clampText):title 500 / url 2000 / description 1000 /
  // cover_image、favicon 2000;上限后同值落库与回传 payloadRow(快照同口径)。
  const title = clampText(payload.title, 500) ?? ''
  const url = clampText(payload.url, 2000) ?? ''
  const normalizedUrl = normalizeBookmarkUrl(url)
  const description = clampText(payload.description, 1000)
  const coverImage = clampText(payload.cover_image, 2000)
  const favicon = clampText(payload.favicon, 2000)

  // The upsert keys on `id`; a URL another row already owns would raise a
  // constraint error mid-push and wedge the batch — detect up front, reject
  // just this op. UNIQUE(user_id, url) covers all rows; the partial unique
  // index (0124) covers live rows only (un-delete can collide with a live one).
  const duplicate = await db
    .prepare(
      `SELECT id FROM bookmarks
       WHERE user_id = ? AND id != ?
         AND (url = ? OR (normalized_url = ? AND deleted_at IS NULL))
       LIMIT 1`
    )
    .bind(userId, entityId, url, normalizedUrl)
    .first<{ id: string }>()
  if (duplicate) {
    return {
      ok: false,
      code: 'DUPLICATE_URL',
      reason: 'Another bookmark in this account already uses this URL.',
    }
  }

  await db
    .prepare(
      `INSERT INTO bookmarks
       (id, user_id, title, url, normalized_url, description, folder_id, cover_image, favicon, is_pinned,
        pin_order, is_todo, is_archived, is_private, position, revision, created_at, updated_at, deleted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
       ON CONFLICT(id)
       DO UPDATE SET
         title = excluded.title,
         url = excluded.url,
         normalized_url = excluded.normalized_url,
         description = excluded.description,
         folder_id = excluded.folder_id,
         cover_image = excluded.cover_image,
         favicon = excluded.favicon,
         is_pinned = excluded.is_pinned,
         pin_order = excluded.pin_order,
         is_todo = excluded.is_todo,
         is_archived = excluded.is_archived,
         is_private = excluded.is_private,
         position = excluded.position,
         revision = excluded.revision,
         updated_at = excluded.updated_at,
         deleted_at = NULL`
    )
    .bind(
      entityId,
      userId,
      title,
      url,
      normalizedUrl,
      description,
      payload.folder_id ?? null,
      coverImage,
      favicon,
      toBooleanInt(payload.is_pinned),
      payload.pin_order ?? 0,
      toBooleanInt(payload.is_todo),
      toBooleanInt(payload.is_archived),
      toBooleanInt(payload.is_private),
      payload.position ?? 0,
      revision,
      now,
      now
    )
    .run()

  const tags = await replaceBookmarkTagLinks(db, userId, entityId, payload, now)
  // The row we just wrote, in loadServerPayload's exact shape — lets the
  // caller skip the 2-query read-back (2 D1 round trips per pushed op).
  const payloadRow = {
    id: entityId, title, url,
    description,
    folder_id: payload.folder_id ?? null,
    cover_image: coverImage,
    favicon,
    is_pinned: toBooleanInt(payload.is_pinned),
    pin_order: payload.pin_order ?? 0,
    is_todo: toBooleanInt(payload.is_todo),
    is_archived: toBooleanInt(payload.is_archived),
    is_private: toBooleanInt(payload.is_private),
    position: payload.position ?? 0,
    click_count: owner ? Number(owner.click_count ?? 0) : 0,
    last_clicked_at: owner ? owner.last_clicked_at : null,
    revision, created_at: owner ? owner.created_at : now,
    updated_at: now, deleted_at: null, tags,
  }
  return { ok: true, payload: payloadRow }
}

async function replaceBookmarkTagLinks(
  db: D1Database,
  userId: string,
  bookmarkId: string,
  payload: BookmarkSyncPayload,
  now: string
): Promise<Array<{ id: string; name: string; color: string | null }>> {
  const tagIds = uniqueStrings(payload.tag_ids)
  const tagNames = uniqueStrings(payload.tag_names)
  const shouldReplaceTags = Array.isArray(payload.tag_ids) || Array.isArray(payload.tag_names)
  if (!shouldReplaceTags) return []

  // Two reads + ONE batch (was: one round trip per tag id, per name lookup,
  // per undelete, per insert, per link — 7+ sequential queries for a bookmark
  // with 3 tags, multiplied across every pushed operation).

  const resolvedTags: Array<{ id: string; name: string; color: string | null }> = []
  if (tagIds.length > 0) {
    // Chunked against D1's 100-bound-parameter cap (user + N ids).
    for (const chunk of chunkForD1In(tagIds, 1)) {
      const placeholders = chunk.map(() => '?').join(',')
      const { results: liveIds } = await db
        .prepare(`SELECT id, name, color FROM tags WHERE user_id = ? AND deleted_at IS NULL AND id IN (${placeholders})`)
        .bind(userId, ...chunk)
        .all<{ id: string; name: string; color: string | null }>()
      for (const row of liveIds || []) resolvedTags.push(row)
    }
  }

  const statements: D1PreparedStatement[] = []
  if (tagNames.length > 0) {
    // LOWER() matching aligns with the REST plane's resolveOrCreateTagIds
    // (case-insensitive reuse) instead of the old exact-match that could
    // mint a duplicate "linux" next to an existing "Linux".
    const named: Array<{ id: string; name: string; color: string | null; deleted_at: string | null }> = []
    for (const chunk of chunkForD1In(tagNames, 1)) {
      const placeholders = chunk.map(() => '?').join(',')
      const { results } = await db
        .prepare(`SELECT id, name, color, deleted_at FROM tags WHERE user_id = ? AND LOWER(name) IN (${placeholders})`)
        .bind(userId, ...chunk.map((name) => name.toLowerCase()))
        .all<{ id: string; name: string; color: string | null; deleted_at: string | null }>()
      named.push(...(results || []))
    }
    const byLower = new Map<string, { id: string; name: string; color: string | null; deleted_at: string | null }>()
    for (const row of named) byLower.set(row.name.toLowerCase(), row)

    for (const tagName of tagNames) {
      const found = byLower.get(tagName.toLowerCase())
      if (found) {
        if (found.deleted_at !== null) {
          statements.push(
            db.prepare('UPDATE tags SET deleted_at = NULL, updated_at = ? WHERE id = ? AND user_id = ?')
              .bind(now, found.id, userId)
          )
        }
        resolvedTags.push({ id: found.id, name: found.name, color: found.color })
        continue
      }

      const tagId = generateUUID()
      statements.push(
        db.prepare(
          `INSERT INTO tags (id, user_id, name, color, click_count, created_at, updated_at, deleted_at)
           VALUES (?, ?, ?, NULL, 0, ?, ?, NULL)`
        ).bind(tagId, userId, tagName, now, now)
      )
      statements.push(
        db.prepare(
          `INSERT INTO sync_entity_revisions (user_id, entity_type, entity_id, revision, updated_at)
           VALUES (?, 'tag', ?, ?, ?)
           ON CONFLICT(user_id, entity_type, entity_id)
           DO UPDATE SET revision = excluded.revision, updated_at = excluded.updated_at`
        ).bind(userId, tagId, createRevision(), now)
      )
      resolvedTags.push({ id: tagId, name: tagName, color: null })
    }
  }

  statements.push(
    db.prepare('DELETE FROM bookmark_tags WHERE bookmark_id = ? AND user_id = ?').bind(bookmarkId, userId)
  )
  for (const tag of resolvedTags) {
    statements.push(
      db.prepare('INSERT OR IGNORE INTO bookmark_tags (bookmark_id, tag_id, user_id, created_at) VALUES (?, ?, ?, ?)')
        .bind(bookmarkId, tag.id, userId, now)
    )
  }

  await db.batch(statements)
  // loadServerPayload's tag shape, for the caller's knownPayload.
  return resolvedTags
}
