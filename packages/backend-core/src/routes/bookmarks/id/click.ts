import type { Context } from 'hono'
import type { AppEnv } from '../../../lib/env'
import { success, notFound, internalError } from '../../../lib/response'
import { recordBookmarkClick } from '../../../lib/bookmarks'

/** POST /:id/click — increment a bookmark's click count and record the event. */
export async function clickBookmarkHandler(c: Context<AppEnv>): Promise<Response> {
  const auth = c.get('auth')
  if (!auth) return internalError('User not found')
  const userId = auth.user_id
  const bookmarkId = c.req.param('id')
  if (!bookmarkId) return notFound('Bookmark not found')

  const result = await recordBookmarkClick(c.env.DB, bookmarkId, userId)
  if (!result.success || !result.clicked_at) {
    return result.error === 'Bookmark not found'
      ? notFound(result.error)
      : internalError(result.error || 'Failed to record click')
  }
  return success({ message: 'Click recorded successfully', clicked_at: result.clicked_at })
}
