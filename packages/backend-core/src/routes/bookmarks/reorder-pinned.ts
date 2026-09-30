import type { Context } from 'hono'
import type { AppEnv } from '../../lib/env'
import { chunkForD1In } from '../../lib/d1-chunk'
import { success, badRequest, internalError } from '../../lib/response'
import { emitSyncChanges } from '../../lib/sync/sync-emit'

interface ReorderPinnedRequest {
  bookmark_ids: string[]
}

/** POST /reorder-pinned — set `pin_order` (0-based) for the given pinned bookmarks. */
export async function reorderPinnedHandler(c: Context<AppEnv>): Promise<Response> {
  const auth = c.get('auth')
  if (!auth) return internalError('User not found')
  const userId = auth.user_id

  try {
    const body = await c.req.json<ReorderPinnedRequest>()
    if (!body.bookmark_ids || !Array.isArray(body.bookmark_ids) || body.bookmark_ids.length === 0) {
      return badRequest('bookmark_ids is required and must be a non-empty array')
    }
    // Cap the only unbounded batch array on the bookmarks plane (siblings:
    // bulk 100, reorder 200, batch-create 100).
    if (body.bookmark_ids.length > 200) {
      return badRequest('Maximum 200 bookmarks per reorder')
    }

    // D1 caps bound parameters at 100/query: 200 pinned ids + user_id used to
    // 500 before any write. Chunk the existence read and merge.
    const foundIds = new Set<string>()
    for (const chunk of chunkForD1In(body.bookmark_ids, 1)) {
      const placeholders = chunk.map(() => '?').join(',')
      const { results: bookmarks } = await c.env.DB.prepare(
        `SELECT id FROM bookmarks
         WHERE id IN (${placeholders})
         AND user_id = ?
         AND is_pinned = 1
         AND deleted_at IS NULL`
      )
        .bind(...chunk, userId)
        .all<{ id: string }>()
      for (const row of bookmarks || []) foundIds.add(row.id)
    }

    // Deduped comparison: duplicate ids must not fake "not found".
    if (foundIds.size !== new Set(body.bookmark_ids).size) {
      return badRequest('Some bookmarks are not found, not pinned, or do not belong to you')
    }

    const now = new Date().toISOString()
    const updates = body.bookmark_ids.map((id, index) =>
      c.env.DB
        .prepare('UPDATE bookmarks SET pin_order = ?, updated_at = ? WHERE id = ? AND user_id = ?')
        .bind(index, now, id, userId)
    )

    await c.env.DB.batch(updates)

    await emitSyncChanges(c.env.DB, userId, 'bookmark', body.bookmark_ids, 'upsert')

    return success({
      message: 'Pinned bookmarks reordered successfully',
      count: body.bookmark_ids.length,
    })
  } catch (error) {
    console.error('Reorder pinned bookmarks error:', error)
    return internalError('Failed to reorder pinned bookmarks')
  }
}
