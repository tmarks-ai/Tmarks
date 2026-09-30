import type { Context } from 'hono'
import type { AppEnv } from '../../lib/env'
import { success, internalError } from '../../lib/response'

interface TagWithCount {
  id: string
  name: string
  color: string | null
  click_count: number
  bookmark_count: number
  created_at: string
  updated_at: string
}

function tagListOrderBy(sort: string | null): string {
  if (sort === 'usage') return 't.bookmark_count DESC, t.name ASC'
  if (sort === 'clicks') return 't.click_count DESC, t.name ASC'
  return 't.name ASC'
}

/** GET / — list the user's tags; counts are maintained on tags.bookmark_count. */
export async function listTagsHandler(c: Context<AppEnv>): Promise<Response> {
  const auth = c.get('auth')
  if (!auth) return internalError('User not found')
  const userId = auth.user_id
  const sort = new URL(c.req.url).searchParams.get('sort')

  try {
    const { results } = await c.env.DB.prepare(
      `SELECT t.id, t.name, t.color, t.click_count, t.bookmark_count, t.created_at, t.updated_at
       FROM tags t
       WHERE t.user_id = ? AND t.deleted_at IS NULL
       ORDER BY ${tagListOrderBy(sort)}`
    )
      .bind(userId)
      .all<TagWithCount>()

    return success({ tags: results })
  } catch (error) {
    console.error('Get tags error:', error)
    return internalError('Failed to get tags')
  }
}
