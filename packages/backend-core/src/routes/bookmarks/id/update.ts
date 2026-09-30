import type { Context } from 'hono'
import type { AppEnv } from '../../../lib/env'
import { success, badRequest, notFound, internalError } from '../../../lib/response'
import { isValidUrl, sanitizeString } from '../../../lib/validation'
import {
  normalizeBookmark,
  getBookmarkFolderPath,
  resolveBookmarkFolderId,
  resolveBookmarkFolderPath,
  requireBookmarkUpdatePermissions,
  normalizeBookmarkUrl,
  schedulePersistFromContext,
} from '../../../lib/bookmarks'
import { getValidTagIds, buildReplaceBookmarkTagsStatements, resolveOrCreateTagIds } from '../../../lib/tags'
import { emitSyncChange } from '../../../lib/sync/sync-emit'
import type { BookmarkRow, SQLParam } from '../../../lib/types'

interface UpdateBookmarkRequest {
  title?: string
  url?: string
  description?: string
  cover_image?: string
  favicon?: string
  folder_id?: string | null
  folder_path?: string[]
  tag_ids?: string[]
  tags?: string[]
  is_pinned?: boolean
  is_todo?: boolean
  is_archived?: boolean
  is_private?: boolean
  position?: number
}

/** PATCH /:id — update bookmark fields and/or replace tags in a single D1 batch. */
export async function updateBookmarkHandler(c: Context<AppEnv>): Promise<Response> {
  const auth = c.get('auth')
  if (!auth) return internalError('User not found')
  const userId = auth.user_id
  const bookmarkId = c.req.param('id')
  if (!bookmarkId) return notFound('Bookmark not found')

  try {
    const existing = await c.env.DB.prepare(
      'SELECT id FROM bookmarks WHERE id = ? AND user_id = ? AND deleted_at IS NULL'
    )
      .bind(bookmarkId, userId)
      .first()

    if (!existing) return notFound('Bookmark not found')

    const body = await c.req.json<UpdateBookmarkRequest>()
    const permissionError = requireBookmarkUpdatePermissions(auth, body)
    if (permissionError) return permissionError

    const updates: string[] = []
    const values: SQLParam[] = []
    // 请求显式提供了图片字段时,保存后由 R2 后台持久化(undefined = 本
    // 次未触碰该字段,保持不动;null = 用户清空,持久化层跳过)。
    let faviconForPersist: string | null | undefined
    let coverForPersist: string | null | undefined

    if (body.title !== undefined) {
      if (!body.title.trim()) return badRequest('Title cannot be empty')
      updates.push('title = ?')
      values.push(sanitizeString(body.title, 500))
    }

    if (body.url !== undefined) {
      if (!body.url.trim()) return badRequest('URL cannot be empty')
      if (!isValidUrl(body.url)) return badRequest('Invalid URL format')
      const sanitizedUrl = sanitizeString(body.url, 2000)
      updates.push('url = ?', 'normalized_url = ?')
      values.push(sanitizedUrl, normalizeBookmarkUrl(sanitizedUrl))
    }

    if (body.description !== undefined) {
      updates.push('description = ?')
      values.push(body.description ? sanitizeString(body.description, 1000) : null)
    }

    if (body.cover_image !== undefined) {
      const coverImage = body.cover_image ? sanitizeString(body.cover_image, 2000) : null
      updates.push('cover_image = ?')
      values.push(coverImage)
      coverForPersist = coverImage
    }

    if (body.favicon !== undefined) {
      const favicon = body.favicon ? sanitizeString(body.favicon, 2000) : null
      updates.push('favicon = ?')
      values.push(favicon)
      faviconForPersist = favicon
    }

    const now = new Date().toISOString()

    if (body.folder_path !== undefined) {
      const folder = await resolveBookmarkFolderPath(c.env.DB, userId, body.folder_path, now)
      if (folder.ok === false) return badRequest(folder.message)
      updates.push('folder_id = ?')
      values.push(folder.folderId)
    } else if (body.folder_id !== undefined) {
      const folder = await resolveBookmarkFolderId(c.env.DB, userId, body.folder_id)
      if (folder.ok === false) return badRequest(folder.message)
      updates.push('folder_id = ?')
      values.push(folder.folderId)
    }

    if (body.is_pinned !== undefined) {
      updates.push('is_pinned = ?')
      values.push(body.is_pinned ? 1 : 0)
      if (body.is_pinned) {
        // Pinning initializes pin_order for cursor pagination; the column is
        // NOT NULL DEFAULT 0 (migration 0106), so unpinning resets to 0
        // instead of NULL — an explicit NULL would violate the constraint.
        const pinRow = await c.env.DB.prepare(
          `SELECT COALESCE(MAX(pin_order), 0) + 1 as next_order
           FROM bookmarks WHERE user_id = ? AND is_pinned = 1 AND deleted_at IS NULL`
        )
          .bind(userId)
          .first<{ next_order: number }>()
        updates.push('pin_order = ?')
        values.push(pinRow?.next_order ?? 1)
      } else {
        updates.push('pin_order = 0')
      }
    }

    if (body.is_todo !== undefined) {
      updates.push('is_todo = ?')
      values.push(body.is_todo ? 1 : 0)
    }

    if (body.is_archived !== undefined) {
      updates.push('is_archived = ?')
      values.push(body.is_archived ? 1 : 0)
    }

    if (body.is_private !== undefined) {
      updates.push('is_private = ?')
      values.push(body.is_private ? 1 : 0)
    }

    if (body.position !== undefined) {
      updates.push('position = ?')
      values.push(body.position)
    }

    const batchStatements: D1PreparedStatement[] = []

    if (updates.length > 0) {
      updates.push('updated_at = ?')
      values.push(now)
      values.push(bookmarkId, userId)
      batchStatements.push(
        c.env.DB.prepare(
          `UPDATE bookmarks SET ${updates.join(', ')} WHERE id = ? AND user_id = ?`
        ).bind(...values)
      )
    }

    if (body.tags !== undefined) {
      const tagIds = await resolveOrCreateTagIds(c.env.DB, userId, body.tags, now)
      batchStatements.push(...buildReplaceBookmarkTagsStatements(c.env.DB, bookmarkId, userId, tagIds, now))
    } else if (body.tag_ids !== undefined) {
      const validTagIds = await getValidTagIds(c.env.DB, userId, body.tag_ids)
      batchStatements.push(...buildReplaceBookmarkTagsStatements(c.env.DB, bookmarkId, userId, validTagIds, now))
    }

    if (batchStatements.length > 0) {
      await c.env.DB.batch(batchStatements)
      await emitSyncChange(c.env.DB, userId, 'bookmark', bookmarkId, 'upsert')

      if (faviconForPersist !== undefined || coverForPersist !== undefined) {
        // Persist favicon/cover into R2 in the background; on success the row
        // is rewritten to a content-addressed asset URL. Failure keeps the
        // remote URLs (never blocks the update response).
        schedulePersistFromContext(c, userId, bookmarkId, faviconForPersist, coverForPersist)
      }
    }

    const bookmarkRow = await c.env.DB.prepare(
      'SELECT * FROM bookmarks WHERE id = ? AND user_id = ?'
    )
      .bind(bookmarkId, userId)
      .first<BookmarkRow>()

    const { results: tags } = await c.env.DB.prepare(
      `SELECT t.id, t.name, t.color
       FROM tags t
       INNER JOIN bookmark_tags bt ON t.id = bt.tag_id
       WHERE bt.bookmark_id = ? AND bt.user_id = ? AND t.deleted_at IS NULL`
    )
      .bind(bookmarkId, userId)
      .all<{ id: string; name: string; color: string | null }>()

    if (!bookmarkRow) return internalError('Failed to load bookmark after update')

    return success({
      bookmark: {
        ...normalizeBookmark(bookmarkRow),
        folder_path: await getBookmarkFolderPath(c.env.DB, userId, bookmarkRow.folder_id),
        tags: tags || [],
      },
    })
  } catch (error) {
    console.error('Update bookmark error:', error)
    return internalError('Failed to update bookmark')
  }
}
