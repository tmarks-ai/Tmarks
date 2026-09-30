import type { Context } from 'hono'
import type { AppEnv } from '../../lib/env'
import { success, notFound, internalError } from '../../lib/response'

/** GET /:id — fetch a single tag with its maintained bookmark count. */
export async function getTagHandler(c: Context<AppEnv>): Promise<Response> {
  const auth = c.get('auth')
  if (!auth) return internalError('User not found')
  const userId = auth.user_id
  const tagId = c.req.param('id')
  if (!tagId) return notFound('Tag not found')

  try {
    const tag = await c.env.DB.prepare(
      `SELECT t.id, t.name, t.color, t.click_count, t.bookmark_count, t.created_at, t.updated_at
       FROM tags t
       WHERE t.id = ? AND t.user_id = ? AND t.deleted_at IS NULL`
    )
      .bind(tagId, userId)
      .first()

    if (!tag) return notFound('Tag not found')
    return success({ tag })
  } catch (error) {
    console.error('Get tag error:', error)
    return internalError('Failed to get tag')
  }
}
