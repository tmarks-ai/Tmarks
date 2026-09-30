import type { Context } from 'hono'
import type { AppEnv } from '../../lib/env'
import { notFound, noContent, internalError } from '../../lib/response'
import { emitSyncChange } from '../../lib/sync/sync-emit'

/** DELETE /:id — soft-delete a tag and detach it from all bookmarks. */
export async function deleteTagHandler(c: Context<AppEnv>): Promise<Response> {
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

    // One batch: partial failure of the old two-step left a hidden tag with
    // live bookmark_tags rows (ghost tags leaking into PATCH read-backs).
    const now = new Date().toISOString()
    await c.env.DB.batch([
      c.env.DB.prepare(
        'UPDATE tags SET deleted_at = ?, updated_at = ? WHERE id = ? AND user_id = ?'
      ).bind(now, now, tagId, userId),
      c.env.DB.prepare('DELETE FROM bookmark_tags WHERE tag_id = ? AND user_id = ?')
        .bind(tagId, userId),
    ])

    await emitSyncChange(c.env.DB, userId, 'tag', tagId, 'delete')

    return noContent()
  } catch (error) {
    console.error('Delete tag error:', error)
    return internalError('Failed to delete tag')
  }
}
