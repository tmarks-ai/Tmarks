import type { Context } from 'hono'
import type { AppEnv } from '../lib/env'
import { unauthorized, internalError, success } from '../lib/response'

interface MeUser {
  id: string
  username: string
  email: string | null
  created_at: string
}

interface BookmarkStats {
  total_bookmarks: number | null
  pinned_bookmarks: number | null
}

/** GET /me — current user, bookmark/tag stats, and (for API-key auth) key info. */
export async function meHandler(c: Context<AppEnv>): Promise<Response> {
  const auth = c.get('auth')
  const userId = auth?.user_id
  if (!userId) {
    return unauthorized('User not found')
  }

  try {
    const user = await c.env.DB
      .prepare('SELECT id, username, email, created_at FROM users WHERE id = ?')
      .bind(userId)
      .first<MeUser>()
    if (!user) {
      return unauthorized('User not found')
    }

    const stats = await c.env.DB
      .prepare(
        `SELECT
          COUNT(CASE WHEN deleted_at IS NULL THEN 1 END) as total_bookmarks,
          COUNT(CASE WHEN deleted_at IS NULL AND is_pinned = 1 THEN 1 END) as pinned_bookmarks
        FROM bookmarks
        WHERE user_id = ?`
      )
      .bind(userId)
      .first<BookmarkStats>()

    const tagCount = await c.env.DB
      .prepare('SELECT COUNT(*) as count FROM tags WHERE user_id = ? AND deleted_at IS NULL')
      .bind(userId)
      .first<{ count: number }>()

    return success({
      user: {
        ...user,
        stats: {
          total_bookmarks: stats?.total_bookmarks ?? 0,
          pinned_bookmarks: stats?.pinned_bookmarks ?? 0,
          total_tags: tagCount?.count || 0,
        },
      },
    })
  } catch (error) {
    console.error('Get user info error:', error)
    return internalError('Failed to get user info')
  }
}
