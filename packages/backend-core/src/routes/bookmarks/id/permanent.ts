import type { Context } from 'hono'
import type { AppEnv } from '../../../lib/env'
import { permanentDeleteBookmark } from '../../../lib/bookmarks'
import { purgeSnapshotObjects } from '../../../lib/bookmarks/snapshot-r2'
import { getSafeWaitUntil } from '../../../lib/safe-wait-until'
import { noContent, notFound, internalError } from '../../../lib/response'

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
  purgeSnapshotObjects(c.env, result.orphanedStorageKeys, getSafeWaitUntil(c), c.req.url)
  if (!result.success) {
    return result.error === 'Bookmark not found in trash'
      ? notFound(result.error)
      : internalError(result.error || 'Failed to permanently delete bookmark')
  }
  return noContent()
}
