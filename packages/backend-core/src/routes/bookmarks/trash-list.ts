import type { Context } from 'hono'
import type { AppEnv } from '../../lib/env'
import { success, internalError } from '../../lib/response'
import { getTrashBookmarks } from '../../lib/bookmarks'

/** GET /trash — cursor-paginated listing of the current user's trashed bookmarks. */
export async function listTrashHandler(c: Context<AppEnv>): Promise<Response> {
  const auth = c.get('auth')
  if (!auth) return internalError('User not found')
  const userId = auth.user_id
  const url = new URL(c.req.url)

  const result = await getTrashBookmarks(c.env.DB, userId, {
    page_size: url.searchParams.get('page_size') || undefined,
    page_cursor: url.searchParams.get('page_cursor') || undefined,
    sort: url.searchParams.get('sort') || undefined,
  })

  if (!result.success || !result.data) {
    return internalError(result.error || 'Failed to get trash bookmarks')
  }
  return success(result.data)
}
