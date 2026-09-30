import type { Context } from 'hono'
import type { AppEnv } from '../../lib/env'
import { created, badRequest, internalError } from '../../lib/response'
import { sanitizeString } from '../../lib/validation'
import { generateUUID } from '../../lib/crypto'
import { mapFolderRow, validateFolderParent } from '../../lib/bookmarks'
import type { BookmarkFolderRow } from '../../lib/types'
import { emitSyncChange } from '../../lib/sync/sync-emit'

interface CreateFolderRequest {
  name?: string
  parent_id?: string | null
}

/** POST / — create a bookmark folder (primary or secondary level only). */
export async function createFolderHandler(c: Context<AppEnv>): Promise<Response> {
  const auth = c.get('auth')
  if (!auth) return internalError('User not found')
  const userId = auth.user_id

  try {
    const body = await c.req.json<CreateFolderRequest>()
    const name = sanitizeString(body.name || '', 120)
    if (!name) return badRequest('Folder name is required')

    const parent = await validateFolderParent(c.env.DB, userId, body.parent_id)
    if (parent.ok === false) return badRequest(parent.message)

    const next = await c.env.DB.prepare(
      `SELECT COALESCE(MAX(position), -1) + 1 as position
       FROM bookmark_folders
       WHERE user_id = ? AND is_deleted = 0
         AND ${parent.folderId ? 'parent_id = ?' : 'parent_id IS NULL'}`
    )
      .bind(...(parent.folderId ? [userId, parent.folderId] : [userId]))
      .first<{ position: number }>()

    const now = new Date().toISOString()
    const folderId = generateUUID()
    await c.env.DB.prepare(
      `INSERT INTO bookmark_folders
       (id, user_id, name, parent_id, position, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(folderId, userId, name, parent.folderId, next?.position || 0, now, now)
      .run()

    const row = await c.env.DB.prepare(
      'SELECT *, 0 as bookmark_count FROM bookmark_folders WHERE id = ? AND user_id = ?'
    )
      .bind(folderId, userId)
      .first<BookmarkFolderRow>()

    await emitSyncChange(c.env.DB, userId, 'bookmark_folder', folderId, 'upsert')

    return created({ folder: row ? mapFolderRow(row) : null })
  } catch (error) {
    console.error('Create bookmark folder error:', error)
    return internalError('Failed to create bookmark folder')
  }
}
