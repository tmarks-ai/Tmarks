import type { BookmarkRow } from '../types'
import { normalizeBookmark } from './bookmark-utils'
import { collectOrphanedAssetKeysBeforeDelete, storageCleanupInsert } from '../storage-cleanup'
import { emitSyncChange, emitSyncChanges } from '../sync/sync-emit'
import type { TrashBookmark } from './trash-types'

/** Permanently delete a bookmark from trash together with its dependent rows. */
export async function permanentDeleteBookmark(db: D1Database, bookmarkId: string, userId: string): Promise<
  { success: boolean; error?: string; orphanedStorageKeys?: string[] }
> {
  try {
    const existing = await db
      .prepare('SELECT id, favicon, cover_image FROM bookmarks WHERE id = ? AND user_id = ? AND deleted_at IS NOT NULL')
      .bind(bookmarkId, userId)
      .first<{ id: string; favicon: string | null; cover_image: string | null }>()

    if (!existing) {
      return { success: false, error: 'Bookmark not found in trash' }
    }

    // FK clauses are declared in the schema and D1 enforces them by default
    // (equivalent to `PRAGMA foreign_keys = on`, R8 IN-1) — the local adapters
    // and the test harness are aligned with that. Every delete path here
    // removes children explicitly anyway, so it stays correct under either
    // enforcement state. Snapshot R2 keys are collected first: dropping only
    // the rows would leak the objects forever (no listing/lifecycle rule).
    const { results: snapshotRows } = await db
      .prepare('SELECT storage_key FROM bookmark_snapshots WHERE bookmark_id = ? AND user_id = ?')
      .bind(bookmarkId, userId)
      .all<{ storage_key: string }>()
    // Resolve asset orphanhood before the D1 delete: after the row is gone we
    // can no longer distinguish a genuinely orphan hash from one that was
    // still referenced by this bookmark. The cleanup INSERTs are part of the
    // same atomic batch as the bookmark/snapshot deletes.
    const assetKeys = await collectOrphanedAssetKeysBeforeDelete(
      db,
      [existing.favicon, existing.cover_image],
      { excludeBookmarkIds: [bookmarkId] },
    )
    const cleanupNow = new Date().toISOString()
    await db.batch([
      db.prepare('DELETE FROM bookmark_tags WHERE bookmark_id = ? AND user_id = ?')
        .bind(bookmarkId, userId),
      db.prepare('DELETE FROM bookmark_click_events WHERE bookmark_id = ? AND user_id = ?')
        .bind(bookmarkId, userId),
      db.prepare('DELETE FROM bookmark_snapshots WHERE bookmark_id = ? AND user_id = ?')
        .bind(bookmarkId, userId),
      db.prepare('DELETE FROM bookmarks WHERE id = ? AND user_id = ?')
        .bind(bookmarkId, userId),
      ...storageCleanupInsert(
        db,
        [
          ...(snapshotRows ?? []).map((row) => ({ storageKey: row.storage_key, kind: 'snapshot' as const, userId })),
          ...assetKeys.map((storageKey) => ({ storageKey, kind: 'asset' as const, userId })),
        ],
        cleanupNow,
      ),
    ])

    // The D1 deletion above is the commit point. Once it succeeds, sync
    // notification and immediate R2 cleanup must not turn the API result into
    // a misleading 500: the durable outbox already owns the retryable keys.
    try {
      // Tombstone the hard delete so other devices drop the row on their next
      // incremental pull instead of waiting for the 24h bootstrap reconciliation.
      await emitSyncChange(db, userId, 'bookmark', bookmarkId, 'delete')
    } catch (error) {
      console.error('Permanent delete sync emit error:', error)
    }

    return {
      success: true,
      orphanedStorageKeys: [...(snapshotRows ?? []).map((row) => row.storage_key), ...assetKeys],
    }
  } catch (error) {
    console.error('Permanent delete bookmark error:', error)
    return { success: false, error: 'Failed to permanently delete bookmark' }
  }
}

/** Restore a bookmark from trash by clearing its `deleted_at`. */
export async function restoreBookmark(
  db: D1Database,
  bookmarkId: string,
  userId: string
): Promise<{ success: boolean; bookmark?: TrashBookmark; error?: string; code?: 'DUPLICATE' }> {
  try {
    const existing = await db
      .prepare('SELECT id, normalized_url FROM bookmarks WHERE id = ? AND user_id = ? AND deleted_at IS NOT NULL')
      .bind(bookmarkId, userId)
      .first<{ id: string; normalized_url: string | null }>()

    if (!existing) {
      return { success: false, error: 'Bookmark not found in trash' }
    }

    // Restoring must not create a live duplicate of an existing bookmark.
    const duplicate = await db
      .prepare(
        'SELECT id FROM bookmarks WHERE user_id = ? AND normalized_url = ? AND deleted_at IS NULL AND id != ?'
      )
      .bind(userId, existing.normalized_url, bookmarkId)
      .first()
    if (duplicate) {
      return { success: false, error: 'A bookmark with this URL already exists', code: 'DUPLICATE' }
    }

    const now = new Date().toISOString()

    await db
      .prepare('UPDATE bookmarks SET deleted_at = NULL, updated_at = ? WHERE id = ? AND user_id = ?')
      .bind(now, bookmarkId, userId)
      .run()

    const bookmarkRow = await db
      .prepare('SELECT * FROM bookmarks WHERE id = ? AND user_id = ?')
      .bind(bookmarkId, userId)
      .first<BookmarkRow>()

    if (!bookmarkRow) {
      return { success: false, error: 'Failed to load bookmark after restore' }
    }

    const { results: tags } = await db
      .prepare(
        `SELECT t.id, t.name, t.color
         FROM tags t
         INNER JOIN bookmark_tags bt ON t.id = bt.tag_id
         WHERE bt.bookmark_id = ? AND bt.user_id = ? AND t.deleted_at IS NULL`
      )
      .bind(bookmarkId, userId)
      .all<{ id: string; name: string; color: string | null }>()

    return {
      success: true,
      bookmark: {
        ...normalizeBookmark(bookmarkRow),
        tags: tags || [],
      },
    }
  } catch (error) {
    console.error('Restore bookmark error:', error)
    return { success: false, error: 'Failed to restore bookmark' }
  }
}

/** Increment a bookmark's click count and record the click event. */
export async function recordBookmarkClick(
  db: D1Database,
  bookmarkId: string,
  userId: string
): Promise<{ success: boolean; clicked_at?: string; error?: string }> {
  try {
    const bookmark = await db
      .prepare('SELECT id FROM bookmarks WHERE id = ? AND user_id = ? AND deleted_at IS NULL')
      .bind(bookmarkId, userId)
      .first()

    if (!bookmark) {
      return { success: false, error: 'Bookmark not found' }
    }

    const now = new Date().toISOString()

    await db.batch([
      db
        .prepare('UPDATE bookmarks SET click_count = click_count + 1, last_clicked_at = ? WHERE id = ? AND user_id = ?')
        .bind(now, bookmarkId, userId),
      db
        .prepare('INSERT INTO bookmark_click_events (bookmark_id, user_id, clicked_at) VALUES (?, ?, ?)')
        .bind(bookmarkId, userId, now),
    ])

    return { success: true, clicked_at: now }
  } catch (error) {
    console.error('Record bookmark click error:', error)
    return { success: false, error: 'Failed to record click' }
  }
}

/** Permanently delete every trashed bookmark for a user. */
export async function emptyTrash(db: D1Database, userId: string): Promise<
  { success: boolean; count?: number; error?: string; orphanedStorageKeys?: string[] }
> {
  try {
    const { results: trashBookmarks } = await db
      .prepare('SELECT id, favicon, cover_image FROM bookmarks WHERE user_id = ? AND deleted_at IS NOT NULL')
      .bind(userId)
      .all<{ id: string; favicon: string | null; cover_image: string | null }>()

    if (trashBookmarks.length === 0) {
      return { success: true, count: 0 }
    }

    const trashSubquery = 'SELECT id FROM bookmarks WHERE user_id = ? AND deleted_at IS NOT NULL'
    // Resolve both R2 key sets before the D1 commit. The outbox INSERTs are
    // included in this same atomic batch as every DELETE below.
    const { results: snapshotRows } = await db
      .prepare(`SELECT storage_key FROM bookmark_snapshots WHERE user_id = ? AND bookmark_id IN (${trashSubquery})`)
      .bind(userId, userId)
      .all<{ storage_key: string }>()
    const assetKeys = await collectOrphanedAssetKeysBeforeDelete(
      db,
      trashBookmarks.flatMap((row) => [row.favicon, row.cover_image]),
      { excludeTrashedForUserId: userId },
    )
    const cleanupNow = new Date().toISOString()
    await db.batch([
      db.prepare(
        `DELETE FROM bookmark_tags
         WHERE user_id = ? AND bookmark_id IN (${trashSubquery})`,
      ).bind(userId, userId),
      db.prepare(
        `DELETE FROM bookmark_click_events
         WHERE user_id = ? AND bookmark_id IN (${trashSubquery})`,
      ).bind(userId, userId),
      db.prepare(
        `DELETE FROM bookmark_snapshots
         WHERE user_id = ? AND bookmark_id IN (${trashSubquery})`,
      ).bind(userId, userId),
      db.prepare('DELETE FROM bookmarks WHERE user_id = ? AND deleted_at IS NOT NULL').bind(userId),
      ...storageCleanupInsert(
        db,
        [
          ...(snapshotRows ?? []).map((row) => ({ storageKey: row.storage_key, kind: 'snapshot' as const, userId })),
          ...assetKeys.map((storageKey) => ({ storageKey, kind: 'asset' as const, userId })),
        ],
        cleanupNow,
      ),
    ])

    // ---- 删除已提交:此后任何失败都不能把已成功的删除报成 500——那会让
    // 客户端误以为失败而重试。同步广播失败只记日志,R2 清理由 outbox 重试。
    try {
      await emitSyncChanges(db, userId, 'bookmark', trashBookmarks.map((row) => row.id), 'delete')
    } catch (error) {
      console.error('Empty trash sync emit error:', error)
    }

    return {
      success: true,
      count: trashBookmarks.length,
      orphanedStorageKeys: [...(snapshotRows ?? []).map((row) => row.storage_key), ...assetKeys],
    }
  } catch (error) {
    console.error('Empty trash error:', error)
    return { success: false, error: 'Failed to empty trash' }
  }
}
