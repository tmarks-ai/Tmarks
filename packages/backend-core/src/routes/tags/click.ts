import type { Context } from 'hono'
import type { AppEnv } from '../../lib/env'
import { success, notFound, internalError } from '../../lib/response'

/** PATCH /:id/click — increment a tag's click count. */
export async function clickTagHandler(c: Context<AppEnv>): Promise<Response> {
  const auth = c.get('auth')
  if (!auth) return internalError('User not found')
  const userId = auth.user_id
  const tagId = c.req.param('id')
  if (!tagId) return notFound('Tag not found')

  try {
    const existing = await c.env.DB.prepare(
      'SELECT id FROM tags WHERE id = ? AND user_id = ? AND deleted_at IS NULL'
    )
      .bind(tagId, userId)
      .first()
    if (!existing) return notFound('Tag not found')

    const now = new Date().toISOString()
    await c.env.DB.prepare(
      `UPDATE tags
       SET click_count = click_count + 1, last_clicked_at = ?, updated_at = ?
       WHERE id = ? AND user_id = ?`
    )
      .bind(now, now, tagId, userId)
      .run()

    return success({ message: 'Click count incremented' })
  } catch (error) {
    console.error('Increment tag click count error:', error)
    return internalError('Failed to increment click count')
  }
}
