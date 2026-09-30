import type { Context } from 'hono'
import type { BatchActionRequest, BatchActionResponse } from '@tmarks/contracts'
import type { AppEnv } from '../../lib/env'
import { requireApiKeyPermissions } from '../../lib/api-key'
import { resolveBookmarkFolderId } from '../../lib/bookmarks'
import { chunkForD1In } from '../../lib/d1-chunk'
import { getValidTagIds } from '../../lib/tags'
import { badRequest, internalError, success } from '../../lib/response'
import { emitSyncChanges } from '../../lib/sync/sync-emit'

const MAX_BATCH_SIZE = 100
// add/remove tag ids each feed an IN(...) alongside the bookmark ids; 90 keeps
// every emitted statement inside D1's 100-bound-parameter budget.
const MAX_BULK_TAG_IDS = 90

/** POST /bulk - apply one action to up to 100 live bookmarks in one D1 batch. */
export async function bulkBookmarksHandler(c: Context<AppEnv>): Promise<Response> {
  const auth = c.get('auth')
  if (!auth) return internalError('User not found')

  try {
    const body = await c.req.json<BatchActionRequest>()
    const validation = validateRequest(body)
    if (validation) return badRequest(validation)

    const permissionError = requireApiKeyPermissions(auth, permissionsFor(body.action))
    if (permissionError) return permissionError

    const bookmarkIds = uniqueStrings(body.bookmark_ids)
    // D1 caps bound parameters at 100/query; 100 ids + user_id used to 500 at
    // this route's own advertised maximum. Chunk the existence read.
    const foundIds = new Set<string>()
    for (const chunk of chunkForD1In(bookmarkIds, 1)) {
      const placeholders = chunk.map(() => '?').join(',')
      const { results } = await c.env.DB.prepare(
        `SELECT id FROM bookmarks
         WHERE id IN (${placeholders}) AND user_id = ? AND deleted_at IS NULL`,
      ).bind(...chunk, auth.user_id).all<{ id: string }>()
      for (const row of results || []) foundIds.add(row.id)
    }

    const validIds = bookmarkIds.filter((id) => foundIds.has(id))
    if (validIds.length === 0) return badRequest('No live bookmarks found')
    const validIdSet = new Set(validIds)
    const errors = bookmarkIds
      .filter((id) => !validIdSet.has(id))
      .map((bookmark_id) => ({ bookmark_id, message: 'Bookmark not found' }))

    const now = new Date().toISOString()
    const statements: D1PreparedStatement[] = []

    if (body.action === 'update_tags') {
      const addTagIds = await validateTagIds(c.env.DB, auth.user_id, body.add_tag_ids)
      const removeTagIds = await validateTagIds(c.env.DB, auth.user_id, body.remove_tag_ids)
      const requestedTagIds = uniqueStrings([...(body.add_tag_ids || []), ...(body.remove_tag_ids || [])])
      if (requestedTagIds.length !== addTagIds.length + removeTagIds.length) return badRequest('One or more tags were not found')

      for (const tagId of addTagIds) {
        // 4 fixed params (tagId, user, now, user) + the id chunk.
        for (const idChunk of chunkForD1In(validIds, 4)) {
          const placeholders = idChunk.map(() => '?').join(',')
          statements.push(c.env.DB.prepare(
            `INSERT OR IGNORE INTO bookmark_tags (bookmark_id, tag_id, user_id, created_at)
             SELECT id, ?, ?, ? FROM bookmarks
             WHERE id IN (${placeholders}) AND user_id = ? AND deleted_at IS NULL`,
          ).bind(tagId, auth.user_id, now, ...idChunk, auth.user_id))
        }
      }
      if (removeTagIds.length > 0) {
        const tagPlaceholders = removeTagIds.map(() => '?').join(',')
        // The tag list is capped at MAX_BULK_TAG_IDS by validateRequest, so
        // ids chunked against (tags + user) always leaves room.
        for (const idChunk of chunkForD1In(validIds, removeTagIds.length + 1)) {
          const placeholders = idChunk.map(() => '?').join(',')
          statements.push(c.env.DB.prepare(
            `DELETE FROM bookmark_tags
             WHERE bookmark_id IN (${placeholders}) AND tag_id IN (${tagPlaceholders}) AND user_id = ?`,
          ).bind(...idChunk, ...removeTagIds, auth.user_id))
        }
      }
      for (const idChunk of chunkForD1In(validIds, 2)) {
        const placeholders = idChunk.map(() => '?').join(',')
        statements.push(c.env.DB.prepare(
          `UPDATE bookmarks SET updated_at = ? WHERE id IN (${placeholders}) AND user_id = ?`,
        ).bind(now, ...idChunk, auth.user_id))
      }
    } else if (body.action === 'delete') {
      for (const idChunk of chunkForD1In(validIds, 3)) {
        const placeholders = idChunk.map(() => '?').join(',')
        statements.push(c.env.DB.prepare(
          `UPDATE bookmarks SET deleted_at = ?, updated_at = ?
           WHERE id IN (${placeholders}) AND user_id = ? AND deleted_at IS NULL`,
        ).bind(now, now, ...idChunk, auth.user_id))
      }
    } else if (body.action === 'move') {
      const folder = await resolveBookmarkFolderId(c.env.DB, auth.user_id, body.folder_id)
      if (!folder.ok) return badRequest(folder.message)
      for (const idChunk of chunkForD1In(validIds, 3)) {
        const placeholders = idChunk.map(() => '?').join(',')
        statements.push(c.env.DB.prepare(
          `UPDATE bookmarks SET folder_id = ?, updated_at = ?
           WHERE id IN (${placeholders}) AND user_id = ? AND deleted_at IS NULL`,
        ).bind(folder.folderId, now, ...idChunk, auth.user_id))
      }
    } else if (body.action === 'pin' || body.action === 'unpin') {
      // Pinning initializes pin_order per bookmark (MAX+1 relative to the user's
      // live pinned set) so cursor pagination can't drop pinned rows; unpinning
      // resets it to 0 (the column is NOT NULL DEFAULT 0, an explicit NULL
      // would violate the constraint). Values are assigned sequentially from
      // the same base read.
      let nextOrder = 1
      if (body.action === 'pin') {
        const pinRow = await c.env.DB.prepare(
          `SELECT COALESCE(MAX(pin_order), 0) + 1 as next_order
           FROM bookmarks WHERE user_id = ? AND is_pinned = 1 AND deleted_at IS NULL`
        ).bind(auth.user_id).first<{ next_order: number }>()
        nextOrder = pinRow?.next_order ?? 1
      }
      const pinValue = body.action === 'pin' ? 1 : 0
      for (const id of validIds) {
        statements.push(c.env.DB.prepare(
          `UPDATE bookmarks SET is_pinned = ?, pin_order = ?, updated_at = ?
           WHERE id = ? AND user_id = ? AND deleted_at IS NULL`,
        ).bind(pinValue, pinValue === 1 ? nextOrder++ : 0, now, id, auth.user_id))
      }
    } else {
      const fieldByAction: Record<string, string> = {
        todo: 'is_todo',
        untodo: 'is_todo',
        archive: 'is_archived',
        unarchive: 'is_archived',
      }
      const field = fieldByAction[body.action]
      const value = body.action === 'todo' || body.action === 'archive' ? 1 : 0
      for (const idChunk of chunkForD1In(validIds, 3)) {
        const placeholders = idChunk.map(() => '?').join(',')
        statements.push(c.env.DB.prepare(
          `UPDATE bookmarks SET ${field} = ?, updated_at = ?
           WHERE id IN (${placeholders}) AND user_id = ? AND deleted_at IS NULL`,
        ).bind(value, now, ...idChunk, auth.user_id))
      }
    }

    await c.env.DB.batch(statements)

    await emitSyncChanges(
      c.env.DB,
      auth.user_id,
      'bookmark',
      validIds,
      body.action === 'delete' ? 'delete' : 'upsert'
    )

    const response: BatchActionResponse = {
      success: errors.length === 0,
      affected_count: validIds.length,
      ...(errors.length > 0 ? { errors } : {}),
    }
    return success(response)
  } catch (error) {
    console.error('Bulk bookmark action error:', error)
    return internalError('Failed to process bulk bookmark action')
  }
}

function validateRequest(body: BatchActionRequest): string | null {
  if (!body || !body.action || !Array.isArray(body.bookmark_ids) || body.bookmark_ids.length === 0) {
    return 'action and a non-empty bookmark_ids array are required'
  }
  const supportedActions = new Set<BatchActionRequest['action']>([
    'delete',
    'update_tags',
    'pin',
    'unpin',
    'todo',
    'untodo',
    'archive',
    'unarchive',
    'move',
  ])
  if (!supportedActions.has(body.action as BatchActionRequest['action'])) return 'Unsupported bulk action'
  if (body.bookmark_ids.length > MAX_BATCH_SIZE) return `Maximum ${MAX_BATCH_SIZE} bookmarks per batch`
  if (uniqueStrings(body.bookmark_ids).length === 0) return 'No valid bookmark IDs provided'
  if (body.action === 'update_tags') {
    if (!body.add_tag_ids?.length && !body.remove_tag_ids?.length) {
      return 'At least one tag ID is required for update_tags'
    }
    if (uniqueStrings(body.add_tag_ids).length > MAX_BULK_TAG_IDS || uniqueStrings(body.remove_tag_ids).length > MAX_BULK_TAG_IDS) {
      return `Maximum ${MAX_BULK_TAG_IDS} tag IDs per add/remove list`
    }
  }
  if (body.action === 'move' && body.folder_id === undefined) return 'folder_id is required for move'
  return null
}

function permissionsFor(action: BatchActionRequest['action']): string[] {
  if (action === 'delete') return ['bookmarks.delete']
  if (action === 'update_tags') return ['tags.assign']
  return ['bookmarks.update']
}

function uniqueStrings(values: unknown): string[] {
  if (!Array.isArray(values)) return []
  return [...new Set(values.filter((value): value is string => typeof value === 'string' && value.trim().length > 0).map((value) => value.trim()))]
}

async function validateTagIds(db: D1Database, userId: string, tagIds: string[] | undefined): Promise<string[]> {
  return getValidTagIds(db, userId, uniqueStrings(tagIds))
}
