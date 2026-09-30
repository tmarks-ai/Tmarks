import type { Context } from 'hono'
import type { AppEnv } from '../../lib/env'
import { success, badRequest, created, internalError } from '../../lib/response'
import { isValidUrl, sanitizeString } from '../../lib/validation'
import { generateUUID } from '../../lib/crypto'
import {
  normalizeBookmark,
  getBookmarkFolderPath,
  resolveBookmarkFolderId,
  resolveBookmarkFolderPath,
  requireBookmarkCreatePermissions,
  normalizeBookmarkUrl,
  schedulePersistFromContext,
  type BatchCreateBookmarkInput,
} from '../../lib/bookmarks'
import { getValidTagIds, resolveOrCreateTagIds, buildReplaceBookmarkTagsStatements } from '../../lib/tags'
import { runBatchCreate } from './batch'
import { emitSyncChange } from '../../lib/sync/sync-emit'
import type { BookmarkRow } from '../../lib/types'

interface CreateBookmarkRequest {
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
  is_private?: boolean
  bookmarks?: BatchCreateBookmarkInput[]
}

/** POST /bookmarks — create a single bookmark, or a batch when `bookmarks` is supplied. */
export async function createBookmarkHandler(c: Context<AppEnv>): Promise<Response> {
  const auth = c.get('auth')
  if (!auth) return internalError('User not found')
  const userId = auth.user_id

  try {
    const body = await c.req.json<CreateBookmarkRequest>()

    if (body.bookmarks && Array.isArray(body.bookmarks) && body.bookmarks.length > 0) {
      return runBatchCreate(c, userId, body.bookmarks, 'api')
    }

    const permissionError = requireBookmarkCreatePermissions(auth, body)
    if (permissionError) return permissionError

    if (!body.title || !body.url) {
      return badRequest({
        message: 'Title and URL are required',
        code: 'MISSING_FIELDS',
      })
    }

    if (!isValidUrl(body.url)) {
      return badRequest('Invalid URL format')
    }

    const title = sanitizeString(body.title, 500)
    const url = sanitizeString(body.url, 2000)
    const normalizedUrl = normalizeBookmarkUrl(url)
    const description = body.description ? sanitizeString(body.description, 1000) : null
    const coverImage = body.cover_image ? sanitizeString(body.cover_image, 2000) : null
    const favicon = body.favicon ? sanitizeString(body.favicon, 2000) : null
    // Two point seeks instead of the OR-form (which the planner executes as a
    // full scan of the user's bookmarks — every create paid ~2k read rows).
    // byUrl covers live AND soft-deleted rows (UNIQUE(user_id, url) index);
    // byNormalized only needs live rows (partial unique index). A soft-deleted
    // row is therefore found again by exact URL but no longer by a normalized
    // VARIANT URL — that edge now creates a fresh bookmark and the old row
    // stays in trash, which is the cleaner outcome anyway.
    const [byUrl, byNormalized] = await Promise.all([
      c.env.DB.prepare('SELECT id, deleted_at FROM bookmarks WHERE user_id = ? AND url = ?')
        .bind(userId, url)
        .first<{ id: string; deleted_at: string | null }>(),
      normalizedUrl
        ? c.env.DB.prepare(
            'SELECT id, deleted_at FROM bookmarks WHERE user_id = ? AND normalized_url = ? AND deleted_at IS NULL'
          )
            .bind(userId, normalizedUrl)
            .first<{ id: string; deleted_at: string | null }>()
        : Promise.resolve(null),
    ])
    const existing = byUrl ?? byNormalized
    const restoredDeletedBookmark = Boolean(existing?.deleted_at)

    const now = new Date().toISOString()
    let bookmarkId: string
    const isPinned = body.is_pinned ? 1 : 0
    const isTodo = body.is_todo ? 1 : 0
    const isPrivate = body.is_private ? 1 : 0

    // Pinned bookmarks need an explicit pin_order for cursor pagination; the
    // column is NOT NULL DEFAULT 0 (migration 0106), so non-pinned rows bind 0
    // rather than NULL — an explicit NULL would violate the constraint.
    let pinOrder: number | null = null
    if (isPinned) {
      const pinRow = await c.env.DB.prepare(
        `SELECT COALESCE(MAX(pin_order), 0) + 1 as next_order
         FROM bookmarks WHERE user_id = ? AND is_pinned = 1 AND deleted_at IS NULL`
      )
        .bind(userId)
        .first<{ next_order: number }>()
      pinOrder = pinRow?.next_order ?? 1
    }

    // Bookmark row and tag links must land in ONE batch (mirrors PATCH /:id):
    // a bare .run() for the row followed by a separate tag batch meant a tag
    // failure left the bookmark persisted without tags, and the retry then hit
    // the duplicate-URL early-return above which returns the tag-less row as
    // 200 success — tags silently lost.
    const batchStatements: D1PreparedStatement[] = []

    if (existing) {
      if (!existing.deleted_at) {
        const bookmarkRow = await c.env.DB.prepare('SELECT * FROM bookmarks WHERE id = ? AND user_id = ?')
          .bind(existing.id, userId)
          .first<BookmarkRow>()

        const { results: tags } = await c.env.DB.prepare(
          `SELECT t.id, t.name, t.color
           FROM tags t
           INNER JOIN bookmark_tags bt ON t.id = bt.tag_id
           WHERE bt.bookmark_id = ? AND bt.user_id = ? AND t.deleted_at IS NULL`
        )
          .bind(existing.id, userId)
          .all<{ id: string; name: string; color: string | null }>()

        if (!bookmarkRow) {
          return internalError('Failed to retrieve bookmark')
        }

        const bookmark = normalizeBookmark(bookmarkRow)
        const folderPath = await getBookmarkFolderPath(c.env.DB, userId, bookmark.folder_id)
        return success({
          bookmark: {
            ...bookmark,
            folder_path: folderPath,
            tags: tags || [],
          },
        })
      }

      const folder = Array.isArray(body.folder_path) && body.folder_path.length > 0
        ? await resolveBookmarkFolderPath(c.env.DB, userId, body.folder_path, now)
        : await resolveBookmarkFolderId(c.env.DB, userId, body.folder_id)
      if (folder.ok === false) return badRequest(folder.message)

      bookmarkId = existing.id
      batchStatements.push(
        c.env.DB.prepare(
          `UPDATE bookmarks
           SET title = ?, description = ?, cover_image = ?, favicon = ?,
               folder_id = ?, is_pinned = ?, is_private = ?, is_todo = 0, is_archived = 0,
               url = ?, normalized_url = ?, pin_order = ?,
               deleted_at = NULL, updated_at = ?
           WHERE id = ? AND user_id = ?`
        )
          .bind(title, description, coverImage, favicon, folder.folderId, isPinned, isPrivate, url, normalizedUrl, pinOrder ?? 0, now, bookmarkId, userId)
      )
    } else {
      const folder = Array.isArray(body.folder_path) && body.folder_path.length > 0
        ? await resolveBookmarkFolderPath(c.env.DB, userId, body.folder_path, now)
        : await resolveBookmarkFolderId(c.env.DB, userId, body.folder_id)
      if (folder.ok === false) return badRequest(folder.message)

      bookmarkId = generateUUID()
      batchStatements.push(
        c.env.DB.prepare(
          `INSERT INTO bookmarks (id, user_id, folder_id, title, url, normalized_url, description, cover_image, favicon, is_pinned, pin_order, is_todo, is_private, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
          .bind(bookmarkId, userId, folder.folderId, title, url, normalizedUrl, description, coverImage, favicon, isPinned, pinOrder ?? 0, isTodo, isPrivate, now, now)
      )
    }

    if (body.tags !== undefined) {
      const tagIds = await resolveOrCreateTagIds(c.env.DB, userId, body.tags, now)
      batchStatements.push(...buildReplaceBookmarkTagsStatements(c.env.DB, bookmarkId, userId, tagIds, now))
    } else if (body.tag_ids !== undefined) {
      const validTagIds = await getValidTagIds(c.env.DB, userId, body.tag_ids)
      batchStatements.push(...buildReplaceBookmarkTagsStatements(c.env.DB, bookmarkId, userId, validTagIds, now))
    } else if (restoredDeletedBookmark) {
      batchStatements.push(...buildReplaceBookmarkTagsStatements(c.env.DB, bookmarkId, userId, [], now))
    }

    await c.env.DB.batch(batchStatements)

    const bookmarkRow = await c.env.DB.prepare('SELECT * FROM bookmarks WHERE id = ? AND user_id = ?')
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

    if (!bookmarkRow) {
      return internalError('Failed to load bookmark after creation')
    }

    // Emitted after the tag links land so the change payload carries them.
    await emitSyncChange(c.env.DB, userId, 'bookmark', bookmarkId, 'upsert')

    // Persist favicon/cover into R2 in the background; on success the row is
    // rewritten to a content-addressed asset URL and a follow-up change is
    // emitted. Failure keeps the remote URLs (never blocks the response).
    schedulePersistFromContext(c, userId, bookmarkId, favicon, coverImage)

    return created({
      bookmark: {
        ...normalizeBookmark(bookmarkRow),
        folder_path: await getBookmarkFolderPath(c.env.DB, userId, bookmarkRow.folder_id),
        tags: tags || [],
      },
    })
  } catch (error) {
    console.error('Create bookmark error:', error)
    return internalError('Failed to create bookmark')
  }
}
