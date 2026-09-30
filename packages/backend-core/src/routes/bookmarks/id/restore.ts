import type { Context } from 'hono'
import type { AppEnv } from '../../../lib/env'
import { success, notFound, internalError, conflict } from '../../../lib/response'
import { restoreBookmark } from '../../../lib/bookmarks'
import { emitSyncChange } from '../../../lib/sync/sync-emit'

/** PATCH /:id/restore — restore a bookmark from trash by clearing `deleted_at`. */
export async function restoreBookmarkHandler(c: Context<AppEnv>): Promise<Response> {
  const auth = c.get('auth')
  if (!auth) return internalError('User not found')
  const userId = auth.user_id
  const bookmarkId = c.req.param('id')
  if (!bookmarkId) return notFound('Bookmark not found')

  const result = await restoreBookmark(c.env.DB, bookmarkId, userId)
  if (!result.success) {
    if (result.code === 'DUPLICATE') {
      return conflict(result.error || 'A bookmark with this URL already exists')
    }
    return result.error === 'Bookmark not found in trash'
      ? notFound(result.error)
      : internalError(result.error || 'Failed to restore bookmark')
  }
  if (!result.bookmark) return internalError('Failed to load bookmark after restore')
  await emitSyncChange(c.env.DB, userId, 'bookmark', bookmarkId, 'upsert')
  return success({ bookmark: result.bookmark })
}
