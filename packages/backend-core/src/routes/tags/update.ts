import type { Context } from 'hono'
import type { AppEnv } from '../../lib/env'
import { success, badRequest, notFound, conflict, internalError } from '../../lib/response'
import { sanitizeColor, sanitizeString } from '../../lib/validation'
import type { SQLParam } from '../../lib/types'
import { emitSyncChange } from '../../lib/sync/sync-emit'

interface UpdateTagRequest {
  name?: string
  color?: string
}

/** PATCH /:id — rename and/or recolor a tag; 409 on duplicate name. */
export async function updateTagHandler(c: Context<AppEnv>): Promise<Response> {
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

    const body = await c.req.json<UpdateTagRequest>()
    const updates: string[] = []
    const values: SQLParam[] = []

    if (body.name !== undefined) {
      if (!body.name.trim()) return badRequest('Tag name cannot be empty')
      const name = sanitizeString(body.name, 50)
      // Tombstones included on purpose: UNIQUE(user_id, name) parks the name
      // on the tombstone row, so the rename must fail cleanly here — with the
      // filter, the UPDATE below dies on the constraint as a 500 instead.
      // This mirrors the sync plane's applyTagOperation duplicate check. A
      // tombstoned name is reclaimed by creating a tag with it (resurrect),
      // not by renaming onto it.
      const duplicate = await c.env.DB.prepare(
        'SELECT id FROM tags WHERE user_id = ? AND LOWER(name) = LOWER(?) AND id != ?'
      )
        .bind(userId, name, tagId)
        .first()
      if (duplicate) return conflict('Tag with this name already exists', 'TAG_EXISTS')
      updates.push('name = ?')
      values.push(name)
    }

    if (body.color !== undefined) {
      updates.push('color = ?')
      values.push(sanitizeColor(body.color))
    }

    if (updates.length === 0) return badRequest('No fields to update')

    const now = new Date().toISOString()
    updates.push('updated_at = ?')
    values.push(now, tagId, userId)
    await c.env.DB.prepare(
      `UPDATE tags SET ${updates.join(', ')} WHERE id = ? AND user_id = ?`
    )
      .bind(...values)
      .run()

    const tag = await c.env.DB.prepare(
      `SELECT t.id, t.name, t.color, t.click_count, t.bookmark_count, t.created_at, t.updated_at
       FROM tags t
       WHERE t.id = ? AND t.user_id = ?`
    )
      .bind(tagId, userId)
      .first()

    await emitSyncChange(c.env.DB, userId, 'tag', tagId, 'upsert')

    return success({ tag })
  } catch (error) {
    console.error('Update tag error:', error)
    return internalError('Failed to update tag')
  }
}
