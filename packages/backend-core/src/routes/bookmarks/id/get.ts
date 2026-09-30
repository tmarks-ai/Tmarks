import type { Context } from 'hono'
import type { AppEnv } from '../../../lib/env'
import { success, notFound, internalError } from '../../../lib/response'
import { normalizeBookmark, getBookmarkFolderPath } from '../../../lib/bookmarks'
import type { BookmarkRow } from '../../../lib/types'

/** GET /:id — fetch a single non-deleted bookmark with its tags. */
export async function getBookmarkHandler(c: Context<AppEnv>): Promise<Response> {
  const auth = c.get('auth')
  if (!auth) return internalError('User not found')
  const userId = auth.user_id
  const bookmarkId = c.req.param('id')
  if (!bookmarkId) return notFound('Bookmark not found')

  try {
    const bookmarkRow = await c.env.DB.prepare(
      'SELECT * FROM bookmarks WHERE id = ? AND user_id = ? AND deleted_at IS NULL'
    )
      .bind(bookmarkId, userId)
      .first<BookmarkRow>()

    if (!bookmarkRow) return notFound('Bookmark not found')

    const { results: tags } = await c.env.DB.prepare(
      `SELECT t.id, t.name, t.color
       FROM tags t
       INNER JOIN bookmark_tags bt ON t.id = bt.tag_id
       WHERE bt.bookmark_id = ? AND bt.user_id = ? AND t.deleted_at IS NULL`
    )
      .bind(bookmarkId, userId)
      .all<{ id: string; name: string; color: string | null }>()

    return success({
      bookmark: {
        ...normalizeBookmark(bookmarkRow),
        folder_path: await getBookmarkFolderPath(c.env.DB, userId, bookmarkRow.folder_id),
        tags: tags || [],
      },
    })
  } catch (error) {
    console.error('Get bookmark error:', error)
    return internalError('Failed to get bookmark')
  }
}
