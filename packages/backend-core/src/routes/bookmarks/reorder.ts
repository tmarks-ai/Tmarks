import type { Context } from 'hono'
import type { AppEnv } from '../../lib/env'
import { chunkForD1In } from '../../lib/d1-chunk'
import { success, badRequest, internalError } from '../../lib/response'
import { emitSyncChanges } from '../../lib/sync/sync-emit'

interface ReorderItem {
  id: string
  position: number
  folder_id?: string | null
}

interface ReorderBookmarksRequest {
  updates: ReorderItem[]
}

/** POST /reorder — batch set position (and optionally folder_id) for bookmarks in a single D1 batch. Mirrors tab-groups batch-update; folder_id null = move to root. */
export async function reorderBookmarksHandler(c: Context<AppEnv>): Promise<Response> {
  const auth = c.get('auth')
  if (!auth) return internalError('User not found')
  const userId = auth.user_id

  try {
    const body = await c.req.json<ReorderBookmarksRequest>()
    if (!body.updates || !Array.isArray(body.updates) || body.updates.length === 0) {
      return badRequest('updates is required and must be a non-empty array')
    }
    if (body.updates.length > 200) return badRequest('Too many updates (max 200)')

    const ids = body.updates.map((u) => u.id)
    // D1 caps bound parameters at 100/query: 200 ids + user_id used to 500
    // before any write. Chunk the existence read and merge.
    const foundIds = new Set<string>()
    for (const chunk of chunkForD1In(ids, 1)) {
      const placeholders = chunk.map(() => '?').join(',')
      const { results } = await c.env.DB
        .prepare(`SELECT id FROM bookmarks WHERE id IN (${placeholders}) AND user_id = ? AND deleted_at IS NULL`)
        .bind(...chunk, userId)
        .all<{ id: string }>()
      for (const row of results || []) foundIds.add(row.id)
    }

    // IN(...) returns each existing row once; duplicate ids in the request
    // must not fake a mismatch (mirrors bulk's uniqueStrings dedupe).
    if (foundIds.size !== new Set(ids).size) {
      return badRequest('Some bookmarks are not found, deleted, or do not belong to you')
    }

    // Validate any non-null target folders belong to the caller.
    const folderIds = [...new Set(body.updates.map((u) => u.folder_id).filter((f): f is string => typeof f === 'string'))]
    if (folderIds.length > 0) {
      const foundFolders = new Set<string>()
      for (const chunk of chunkForD1In(folderIds, 1)) {
        const fph = chunk.map(() => '?').join(',')
        const { results: folders } = await c.env.DB
          .prepare(`SELECT id FROM bookmark_folders WHERE id IN (${fph}) AND user_id = ? AND (is_deleted IS NULL OR is_deleted = 0)`)
          .bind(...chunk, userId)
          .all<{ id: string }>()
        for (const row of folders || []) foundFolders.add(row.id)
      }
      if (foundFolders.size !== folderIds.length) return badRequest('Target folder not found')
    }

    const now = new Date().toISOString()
    const stmts = body.updates.map((u) =>
      u.folder_id !== undefined
        ? c.env.DB
            .prepare('UPDATE bookmarks SET position = ?, folder_id = ?, updated_at = ? WHERE id = ? AND user_id = ?')
            .bind(u.position, u.folder_id, now, u.id, userId)
        : c.env.DB
            .prepare('UPDATE bookmarks SET position = ?, updated_at = ? WHERE id = ? AND user_id = ?')
            .bind(u.position, now, u.id, userId)
    )

    await c.env.DB.batch(stmts)

    await emitSyncChanges(c.env.DB, userId, 'bookmark', ids, 'upsert')

    return success({ message: 'Bookmarks reordered successfully', count: body.updates.length })
  } catch (error) {
    console.error('Reorder bookmarks error:', error)
    return internalError('Failed to reorder bookmarks')
  }
}
