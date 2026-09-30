import type { Context } from 'hono'
import type { AppEnv } from '../../lib/env'
import { success, badRequest, notFound, internalError } from '../../lib/response'
import { sanitizeString } from '../../lib/validation'
import { mapFolderRow, validateFolderParent } from '../../lib/bookmarks'
import type { BookmarkFolderRow, SQLParam } from '../../lib/types'
import { emitSyncChange } from '../../lib/sync/sync-emit'

interface UpdateFolderRequest {
  name?: string
  parent_id?: string | null
  position?: number
}

/** PATCH /:id — rename and/or reparent/reposition a folder. */
export async function updateFolderHandler(c: Context<AppEnv>): Promise<Response> {
  const auth = c.get('auth')
  if (!auth) return internalError('User not found')
  const userId = auth.user_id
  const folderId = c.req.param('id')
  if (!folderId) return notFound('Folder not found')

  try {
    const existing = await c.env.DB.prepare(
      'SELECT id FROM bookmark_folders WHERE id = ? AND user_id = ? AND is_deleted = 0'
    )
      .bind(folderId, userId)
      .first<{ id: string }>()
    if (!existing) return notFound('Folder not found')

    const body = await c.req.json<UpdateFolderRequest>()
    const updates: string[] = []
    const values: SQLParam[] = []

    if (body.name !== undefined) {
      const name = sanitizeString(body.name, 120)
      if (!name) return badRequest('Folder name is required')
      updates.push('name = ?')
      values.push(name)
    }

    if (body.parent_id !== undefined) {
      if (body.parent_id === folderId) return badRequest('Folder cannot be its own parent')
      const parent = await validateFolderParent(c.env.DB, userId, body.parent_id)
      if (parent.ok === false) return badRequest(parent.message)
      if (parent.folderId) {
        const child = await c.env.DB.prepare(
          'SELECT id FROM bookmark_folders WHERE parent_id = ? AND user_id = ? AND is_deleted = 0 LIMIT 1'
        )
          .bind(folderId, userId)
          .first<{ id: string }>()
        if (child) return badRequest('Folders with children cannot be moved under another folder')
      }
      updates.push('parent_id = ?')
      values.push(parent.folderId)
    }

    if (body.position !== undefined) {
      updates.push('position = ?')
      values.push(Math.max(0, Number(body.position) || 0))
    }

    if (updates.length === 0) return badRequest('No valid fields to update')

    const now = new Date().toISOString()
    updates.push('updated_at = ?')
    values.push(now, folderId, userId)
    await c.env.DB.prepare(
      `UPDATE bookmark_folders SET ${updates.join(', ')} WHERE id = ? AND user_id = ?`
    )
      .bind(...values)
      .run()

    const row = await c.env.DB.prepare(
      `SELECT f.*, COUNT(b.id) as bookmark_count
       FROM bookmark_folders f
       LEFT JOIN bookmarks b ON b.folder_id = f.id AND b.user_id = f.user_id AND b.deleted_at IS NULL
       WHERE f.id = ? AND f.user_id = ?
       GROUP BY f.id`
    )
      .bind(folderId, userId)
      .first<BookmarkFolderRow>()

    await emitSyncChange(c.env.DB, userId, 'bookmark_folder', folderId, 'upsert')

    return success({ folder: row ? mapFolderRow(row) : null })
  } catch (error) {
    console.error('Update bookmark folder error:', error)
    return internalError('Failed to update bookmark folder')
  }
}
