import type { Context } from 'hono'
import type { AppEnv } from '../../../lib/env'
import { success, notFound, internalError } from '../../../lib/response'
import { emitSyncChange } from '../../../lib/sync/sync-emit'

/** PATCH /:id/trash — move a bookmark to trash (soft-delete via `deleted_at`). */
export async function trashBookmarkHandler(c: Context<AppEnv>): Promise<Response> {
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

    const now = new Date().toISOString()
    await c.env.DB.prepare(
      'UPDATE bookmarks SET deleted_at = ?, updated_at = ? WHERE id = ? AND user_id = ?'
    )
      .bind(now, now, bookmarkId, userId)
      .run()

    await emitSyncChange(c.env.DB, userId, 'bookmark', bookmarkId, 'delete')

    return success({ message: 'Bookmark moved to trash' })
  } catch (error) {
    console.error('Trash bookmark error:', error)
    return internalError('Failed to trash bookmark')
  }
}
