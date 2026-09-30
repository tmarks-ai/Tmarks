import { isValidUrl, sanitizeString } from '../validation'
import { generateUUID } from '../crypto'
import { buildReplaceBookmarkTagsStatements, resolveOrCreateTagIdStatements } from '../tags'
import { resolveBookmarkFolderPath } from './folders'
import { normalizeBookmarkUrl } from './bookmark-url'
import { emitSyncChanges } from '../sync/sync-emit'

export type BatchCreateResult = {
  import_batch_id: string
  success: number
  failed: number
  skipped: number
  total: number
  errors: Array<{ index: number; url: string; error: string }>
  created_bookmarks: Array<{ id: string; url: string; title: string; status: 'created' | 'restored' }>
  skipped_bookmarks: Array<{ index: number; url: string; reason: string }>
}

export interface BatchCreateBookmarkInput {
  title: string
  url: string
  description?: string
  cover_image?: string
  favicon?: string
  folder_path?: string[]
  tags?: string[]
  is_pinned?: boolean
  is_private?: boolean
}

/**
 * Create (or restore) a batch of bookmarks within a single user. Each item is
 * processed independently: a failure records into `errors` and continues. URLs
 * that already exist and are not soft-deleted are reported as `skipped` rather
 * than failing the batch. Tag usage counts are recomputed once at the end.
 */
export async function handleBatchCreate(
  db: D1Database,
  userId: string,
  bookmarks: BatchCreateBookmarkInput[],
  now: string
): Promise<BatchCreateResult> {
  const importBatchId = `imp_${generateUUID()}`
  const result: BatchCreateResult = {
    import_batch_id: importBatchId,
    success: 0,
    failed: 0,
    skipped: 0,
    total: bookmarks.length,
    errors: [],
    created_bookmarks: [],
    skipped_bookmarks: [],
  }

  for (let i = 0; i < bookmarks.length; i++) {
    const item = bookmarks[i]!

    try {
      if (!item.title || !item.url) {
        result.failed++
        result.errors.push({
          index: i,
          url: item.url || '',
          error: 'Title and URL are required',
        })
        continue
      }

      if (!isValidUrl(item.url)) {
        result.failed++
        result.errors.push({
          index: i,
          url: item.url,
          error: 'Invalid URL format',
        })
        continue
      }

      const title = sanitizeString(item.title, 500)
      const url = sanitizeString(item.url, 2000)
      const normalizedUrl = normalizeBookmarkUrl(url)
      const description = item.description ? sanitizeString(item.description, 1000) : null
      const coverImage = item.cover_image ? sanitizeString(item.cover_image, 2000) : null
      const favicon = item.favicon ? sanitizeString(item.favicon, 2000) : null
      const isPinned = item.is_pinned ? 1 : 0
      const isPrivate = item.is_private ? 1 : 0

      // Point seeks (see create.ts): the OR-form scanned every user row per
      // imported item — a 100-bookmark import read ~200k rows for dup checks.
      const [byUrl, byNormalized] = await Promise.all([
        db.prepare('SELECT id, deleted_at FROM bookmarks WHERE user_id = ? AND url = ?')
          .bind(userId, url)
          .first<{ id: string; deleted_at: string | null }>(),
        normalizedUrl
          ? db.prepare(
              'SELECT id, deleted_at FROM bookmarks WHERE user_id = ? AND normalized_url = ? AND deleted_at IS NULL'
            )
              .bind(userId, normalizedUrl)
              .first<{ id: string; deleted_at: string | null }>()
          : Promise.resolve(null),
      ])
      const existing = byUrl ?? byNormalized
      const restoredDeletedBookmark = Boolean(existing?.deleted_at)

      let bookmarkId: string

      // The bookmark row write and its tag writes land in ONE batch: as
      // separate awaits, an isolate death in between left the row committed
      // with missing/stale bookmark_tags — and on the restore path the tag
      // SELECT could even run against a row the isolate never wrote.
      const statements: D1PreparedStatement[] = []

      if (existing) {
        if (!existing.deleted_at) {
          result.skipped++
          result.skipped_bookmarks.push({
            index: i,
            url,
            reason: 'duplicate_url',
          })
          continue
        }

        const folder = await resolveBookmarkFolderPath(db, userId, item.folder_path, now)
        if (folder.ok === false) {
          result.failed++
          result.errors.push({
            index: i,
            url: item.url,
            error: folder.message,
          })
          continue
        }

        bookmarkId = existing.id
        // 恢复时重置 pin_order(镜像 create.ts 的 MAX+1 初始化):回收站里遗留的
        // 旧值可能与现存置顶书签撞号,排序抖动。
        const nextPinOrder = await db
          .prepare('SELECT COALESCE(MAX(pin_order), 0) + 1 AS next FROM bookmarks WHERE user_id = ?')
          .bind(userId)
          .first<{ next: number }>()
        statements.push(
          db.prepare(
            `UPDATE bookmarks
             SET title = ?, description = ?, cover_image = ?, favicon = ?,
                 folder_id = ?, is_pinned = ?, is_private = ?, is_archived = 0, normalized_url = ?,
                 pin_order = ?, deleted_at = NULL, updated_at = ?
             WHERE id = ? AND user_id = ?`
          )
            .bind(title, description, coverImage, favicon, folder.folderId, isPinned, isPrivate, normalizedUrl, isPinned ? nextPinOrder?.next ?? 1 : 0, now, bookmarkId, userId)
        )
      } else {
        const folder = await resolveBookmarkFolderPath(db, userId, item.folder_path, now)
        if (folder.ok === false) {
          result.failed++
          result.errors.push({
            index: i,
            url: item.url,
            error: folder.message,
          })
          continue
        }

        bookmarkId = generateUUID()
        statements.push(
          db.prepare(
            `INSERT INTO bookmarks (id, user_id, folder_id, title, url, normalized_url, description, cover_image, favicon, is_pinned, is_private, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          )
            .bind(bookmarkId, userId, folder.folderId, title, url, normalizedUrl, description, coverImage, favicon, isPinned, isPrivate, now, now)
        )
      }

      if (item.tags !== undefined) {
        const { tagIds, createStatements } = await resolveOrCreateTagIdStatements(db, userId, item.tags, now)
        statements.push(...createStatements)
        statements.push(...buildReplaceBookmarkTagsStatements(db, bookmarkId, userId, tagIds, now))
      } else if (restoredDeletedBookmark) {
        statements.push(...buildReplaceBookmarkTagsStatements(db, bookmarkId, userId, [], now))
      }

      await db.batch(statements)

      result.success++
      result.created_bookmarks.push({
        id: bookmarkId,
        url,
        title,
        status: restoredDeletedBookmark ? 'restored' : 'created',
      })
    } catch (error) {
      result.failed++
      result.errors.push({
        index: i,
        url: item.url || '',
        error: 'Failed to create bookmark',
      })
      console.error(`[Batch] Failed to create bookmark ${i}:`, error)
    }
  }

  if (result.success > 0) {
    // Emitted once at the end rather than per item: importing a few thousand
    // bookmarks would otherwise interleave thousands of change writes with the
    // inserts. The extension picks them all up on its next incremental pull.
    await emitSyncChanges(db, userId, 'bookmark', result.created_bookmarks.map((b) => b.id), 'upsert')
  }

  return result
}
