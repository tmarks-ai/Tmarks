import type { Context } from 'hono'
import type { AppEnv } from '../../lib/env'
import { chunkForD1In } from '../../lib/d1-chunk'
import { notFound, noContent, internalError } from '../../lib/response'
import { emitSyncChanges } from '../../lib/sync/sync-emit'

/** DELETE /:id — soft-delete a folder and its direct children; unfile their bookmarks. */
export async function deleteFolderHandler(c: Context<AppEnv>): Promise<Response> {
  const auth = c.get('auth')
  if (!auth) return internalError('User not found')
  const userId = auth.user_id
  const folderId = c.req.param('id')
  if (!folderId) return notFound('Folder not found')

  try {
    const { results } = await c.env.DB.prepare(
      `SELECT id FROM bookmark_folders
       WHERE user_id = ? AND is_deleted = 0 AND (id = ? OR parent_id = ?)`
    )
      .bind(userId, folderId, folderId)
      .all<{ id: string }>()

    const ids = (results || []).map((row) => row.id)
    if (ids.length === 0) return notFound('Folder not found')

    const now = new Date().toISOString()

    // D1 caps bound parameters at 100/query; the folder + its children list
    // is unbounded, so every IN below is chunked.
    const batchStatements: D1PreparedStatement[] = []

    // Captured before the update, which clears folder_id and makes the affected
    // bookmarks unfindable by folder afterwards.
    const unfiled: Array<{ id: string }> = []
    for (const chunk of chunkForD1In(ids, 1)) {
      const unfiledPlaceholders = chunk.map(() => '?').join(',')
      const { results } = await c.env.DB.prepare(
        `SELECT id FROM bookmarks
         WHERE user_id = ? AND deleted_at IS NULL AND folder_id IN (${unfiledPlaceholders})`
      )
        .bind(userId, ...chunk)
        .all<{ id: string }>()
      unfiled.push(...(results || []))
    }

    for (const chunk of chunkForD1In(ids, 3)) {
      const placeholders = chunk.map(() => '?').join(',')
      batchStatements.push(
        c.env.DB.prepare(
          `UPDATE bookmark_folders
           SET is_deleted = 1, deleted_at = ?, updated_at = ?
           WHERE user_id = ? AND id IN (${placeholders})`
        ).bind(now, now, userId, ...chunk)
      )
    }
    for (const chunk of chunkForD1In(ids, 2)) {
      const placeholders = chunk.map(() => '?').join(',')
      batchStatements.push(
        c.env.DB.prepare(
          `UPDATE bookmarks SET folder_id = NULL, updated_at = ?
           WHERE user_id = ? AND folder_id IN (${placeholders})`
        ).bind(now, userId, ...chunk)
      )
    }
    await c.env.DB.batch(batchStatements)

    await emitSyncChanges(c.env.DB, userId, 'bookmark_folder', ids, 'delete')
    // The unfiled bookmarks changed too; without this the extension would keep
    // showing them under a folder that no longer exists.
    await emitSyncChanges(c.env.DB, userId, 'bookmark', (unfiled || []).map((row) => row.id), 'upsert')

    return noContent()
  } catch (error) {
    console.error('Delete bookmark folder error:', error)
    return internalError('Failed to delete bookmark folder')
  }
}
