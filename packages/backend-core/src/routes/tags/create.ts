import type { Context } from 'hono'
import type { AppEnv } from '../../lib/env'
import { created, badRequest, conflict, internalError } from '../../lib/response'
import { sanitizeColor, sanitizeString } from '../../lib/validation'
import { generateUUID } from '../../lib/crypto'
import { emitSyncChange } from '../../lib/sync/sync-emit'

interface CreateTagRequest {
  name: string
  color?: string
}

/** POST / — create a tag; 409 if a non-deleted tag with the same name exists. */
export async function createTagHandler(c: Context<AppEnv>): Promise<Response> {
  const auth = c.get('auth')
  if (!auth) return internalError('User not found')
  const userId = auth.user_id

  try {
    const body = await c.req.json<CreateTagRequest>()
    if (!body.name || !body.name.trim()) return badRequest('Tag name is required')

    const name = sanitizeString(body.name, 50)
    const color = sanitizeColor(body.color)

    // Lower-name match spans live AND tombstoned rows: UNIQUE(user_id, name)
    // parks the name on the tombstone, so a live hit is a 409 while a
    // tombstone hit resurrects that row (the sync plane's name-match
    // semantics) — a fresh INSERT would die on the constraint. Live wins over
    // tombstones when case variants coexist; oldest tombstone wins among
    // tombstones so the pick is deterministic.
    const existing = await c.env.DB.prepare(
      `SELECT id, deleted_at FROM tags
       WHERE user_id = ? AND LOWER(name) = LOWER(?)
       ORDER BY deleted_at IS NULL DESC, updated_at ASC`
    )
      .bind(userId, name)
      .first<{ id: string; deleted_at: string | null }>()
    if (existing && existing.deleted_at === null) return conflict('Tag with this name already exists', 'TAG_EXISTS')

    const now = new Date().toISOString()
    if (existing) {
      const tagId = existing.id
      await c.env.DB.prepare(
        'UPDATE tags SET deleted_at = NULL, color = ?, updated_at = ? WHERE id = ? AND user_id = ?'
      )
        .bind(color, now, tagId, userId)
        .run()
      const tag = await c.env.DB.prepare(
        `SELECT t.id, t.name, t.color, t.click_count, t.bookmark_count, t.created_at, t.updated_at
         FROM tags t WHERE t.id = ?`
      ).bind(tagId).first()

      await emitSyncChange(c.env.DB, userId, 'tag', tagId, 'upsert')

      return created({ tag })
    }

    const tagId = generateUUID()
    await c.env.DB.prepare(
      `INSERT INTO tags (id, user_id, name, color, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`
    )
      .bind(tagId, userId, name, color, now, now)
      .run()

    const tag = await c.env.DB.prepare(
      `SELECT t.id, t.name, t.color, t.click_count, t.bookmark_count, t.created_at, t.updated_at
       FROM tags t WHERE t.id = ?`
    ).bind(tagId).first()

    await emitSyncChange(c.env.DB, userId, 'tag', tagId, 'upsert')

    return created({ tag })
  } catch (error) {
    console.error('Create tag error:', error)
    return internalError('Failed to create tag')
  }
}
