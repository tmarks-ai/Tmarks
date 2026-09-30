import type { Context } from 'hono'
import type { ReorderBookmarkFoldersInput } from '@tmarks/contracts'
import type { AppEnv } from '../../lib/env'
import { chunkForD1In } from '../../lib/d1-chunk'
import { badRequest, internalError, success } from '../../lib/response'
import { emitSyncChanges } from '../../lib/sync/sync-emit'

const MAX_REORDER_UPDATES = 200

/**
 * POST /reorder — batch set `position` for sibling folders in one D1 batch.
 *
 * R5-13: the web panel previously fired one PATCH per sibling per drag (plus
 * the move PATCH), and each mutation invalidated two caches — an N+1 request
 * storm with N folder refetches and N bookmark-cache resets. This endpoint
 * mirrors POST /bookmarks/reorder: one existence read (chunked against D1's
 * 100-bound-parameter cap) and one atomic position batch. parent_id changes
 * deliberately stay on the PATCH path so the two-level hierarchy validation
 * remains in a single place.
 */
export async function reorderFoldersHandler(c: Context<AppEnv>): Promise<Response> {
  const auth = c.get('auth')
  if (!auth) return internalError('User not found')
  const userId = auth.user_id

  try {
    const body = await c.req.json<ReorderBookmarkFoldersInput>()
    if (!body?.updates || !Array.isArray(body.updates) || body.updates.length === 0) {
      return badRequest('updates is required and must be a non-empty array')
    }
    if (body.updates.length > MAX_REORDER_UPDATES) {
      return badRequest(`Too many updates (max ${MAX_REORDER_UPDATES})`)
    }
    for (const update of body.updates) {
      if (typeof update?.id !== 'string' || typeof update?.position !== 'number') {
        return badRequest('Each update needs a string id and a numeric position')
      }
    }

    const ids = body.updates.map((update) => update.id)
    // IN(...) returns each existing row once; duplicate ids must not fake a
    // mismatch (mirrors the bookmarks reorder dedupe).
    const foundIds = new Set<string>()
    for (const chunk of chunkForD1In(ids, 1)) {
      const placeholders = chunk.map(() => '?').join(',')
      const { results } = await c.env.DB
        .prepare(`SELECT id FROM bookmark_folders WHERE id IN (${placeholders}) AND user_id = ? AND is_deleted = 0`)
        .bind(...chunk, userId)
        .all<{ id: string }>()
      for (const row of results || []) foundIds.add(row.id)
    }
    if (foundIds.size !== new Set(ids).size) {
      return badRequest('Some folders are not found or do not belong to you')
    }

    const now = new Date().toISOString()
    const statements = body.updates.map((update) =>
      c.env.DB
        .prepare('UPDATE bookmark_folders SET position = ?, updated_at = ? WHERE id = ? AND user_id = ?')
        .bind(update.position, now, update.id, userId)
    )
    await c.env.DB.batch(statements)

    await emitSyncChanges(c.env.DB, userId, 'bookmark_folder', ids, 'upsert')

    return success({ message: 'Folders reordered successfully', count: body.updates.length })
  } catch (error) {
    console.error('Reorder folders error:', error)
    return internalError('Failed to reorder folders')
  }
}
