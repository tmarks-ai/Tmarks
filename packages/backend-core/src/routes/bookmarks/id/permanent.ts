import type { Context } from 'hono'
import type { AppEnv } from '../../../lib/env'
import { noContent, notFound, internalError } from '../../../lib/response'
import { permanentDeleteBookmark } from '../../../lib/bookmarks'
import { purgeSnapshotObjects } from '../../../lib/bookmarks/snapshot-r2'

/**
 * DELETE /:id/permanent — permanently delete a trashed bookmark together with
 * its tags.
 */
export async function permanentDeleteHandler(c: Context<AppEnv>): Promise<Response> {
  const auth = c.get('auth')
  if (!auth) return internalError('User not found')
  const userId = auth.user_id
  const bookmarkId = c.req.param('id')
  if (!bookmarkId) return notFound('Bookmark not found')

  const result = await permanentDeleteBookmark(c.env.DB, bookmarkId, userId)
  purgeSnapshotObjects(c.env, result.orphanedStorageKeys, (p) => c.executionCtx.waitUntil(p), c.req.url)
  if (!result.success) {
    return result.error === 'Bookmark not found in trash'
      ? notFound(result.error)
      : internalError(result.error || 'Failed to permanently delete bookmark')
  }
  return noContent()
}
