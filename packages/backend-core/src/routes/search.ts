import type { Context } from 'hono'
import type { AppEnv } from '../lib/env'
import { badRequest, internalError, success } from '../lib/response'
import { fetchBookmarkTags, normalizeBookmark } from '../lib/bookmarks'
import { escapeLike } from '../lib/utils'
import type { Bookmark } from '../lib/types'

interface BookmarkTag {
  id: string
  name: string
  color: string | null
}

interface BookmarkWithTags extends Bookmark {
  tags: BookmarkTag[]
}

interface TagSearchRow {
  id: string
  name: string
  color: string | null
  created_at: string
  updated_at: string
  bookmark_count: number
}

/** GET /search — global search across the caller's bookmarks (with tags) and tags. */
export async function searchHandler(c: Context<AppEnv>): Promise<Response> {
  const auth = c.get('auth')
  if (!auth) return internalError('User not found')
  const userId = auth.user_id
  const url = new URL(c.req.url)
  const query = url.searchParams.get('q')

  if (!query || query.trim().length === 0) return badRequest('Search query is required')

  const searchTerm = `%${escapeLike(query.trim())}%`
  const limit = Math.max(1, Math.min(parseInt(url.searchParams.get('limit') || '20', 10) || 20, 100))

  try {
    const { results: bookmarks } = await c.env.DB
      .prepare(
        `SELECT b.* FROM bookmarks b
         WHERE b.user_id = ? AND b.deleted_at IS NULL
         AND (b.title LIKE ? ESCAPE '\\' OR b.description LIKE ? ESCAPE '\\' OR b.url LIKE ? ESCAPE '\\')
         ORDER BY b.is_pinned DESC, b.updated_at DESC LIMIT ?`
      )
      .bind(userId, searchTerm, searchTerm, searchTerm, limit)
      .all<Bookmark>()

    let bookmarksWithTags: BookmarkWithTags[] = (bookmarks || []).map((b) => ({
      ...normalizeBookmark(b),
      tags: [],
    }))

    if (bookmarksWithTags.length > 0) {
      // Shared helper: chunked against D1's 100-bound-parameter cap, so a full
      // 100-result page (limit max) no longer 500s on the tag read.
      const tagsByBookmarkId = await fetchBookmarkTags(c.env.DB, userId, bookmarksWithTags.map((b) => b.id))

      bookmarksWithTags = bookmarksWithTags.map((b) => ({
        ...b,
        tags: tagsByBookmarkId.get(b.id) || [],
      }))
    }

    const { results: tags } = await c.env.DB
      .prepare(
        `SELECT t.id, t.name, t.color, t.created_at, t.updated_at, t.bookmark_count
         FROM tags t
         WHERE t.user_id = ? AND t.deleted_at IS NULL AND t.name LIKE ? ESCAPE '\\'
         ORDER BY t.name ASC LIMIT ?`
      )
      .bind(userId, searchTerm, limit)
      .all<TagSearchRow>()

    return success({
      query,
      results: {
        bookmarks: bookmarksWithTags,
        tags: tags || [],
      },
      meta: {
        bookmark_count: bookmarksWithTags.length,
        tag_count: (tags || []).length,
      },
    })
  } catch (error) {
    console.error('Search error:', error)
    return internalError('Failed to search')
  }
}
