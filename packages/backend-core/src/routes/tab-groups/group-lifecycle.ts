import type { Context } from 'hono'
import type { AppEnv } from '../../lib/env'
import { internalError, notFound, success } from '../../lib/response'
import { emitSyncChange } from '../../lib/sync/sync-emit'

interface TabGroupStateRow {
  id: string
  user_id: string
  is_deleted: number
}

/** DELETE /:id/permanent-delete — permanently delete a trashed tab group and its items. */
export async function permanentDeleteTabGroupHandler(c: Context<AppEnv>): Promise<Response> {
  const auth = c.get('auth')
  if (!auth) return internalError('User not found')
  const userId = auth.user_id
  const groupId = c.req.param('id')
  if (!groupId) return notFound('Tab group not found')

  try {
    const group = await c.env.DB
      .prepare('SELECT id, user_id, is_deleted FROM tab_groups WHERE id = ? AND user_id = ?')
      .bind(groupId, userId)
      .first<TabGroupStateRow>()
    if (!group) return notFound('Tab group not found')
    if (group.is_deleted !== 1) {
      return notFound('Tab group must be in trash before permanent deletion')
    }

    // Permanent delete cascades to the whole subtree: first remove the items of
    // every descendant group, then the descendant groups themselves.
    await c.env.DB.batch([
      c.env.DB.prepare(
        `DELETE FROM tab_group_items WHERE group_id IN (
           WITH RECURSIVE descendants(id) AS (
             SELECT id FROM tab_groups WHERE id = ? AND user_id = ?
             UNION
             SELECT tg.id FROM tab_groups tg
             JOIN descendants d ON tg.parent_id = d.id
             WHERE tg.user_id = ?
           )
           SELECT id FROM descendants
         )`
      ).bind(groupId, userId, userId),
      c.env.DB.prepare(
        `DELETE FROM tab_groups WHERE user_id = ? AND id IN (
           WITH RECURSIVE descendants(id) AS (
             SELECT id FROM tab_groups WHERE id = ? AND user_id = ?
             UNION
             SELECT tg.id FROM tab_groups tg
             JOIN descendants d ON tg.parent_id = d.id
             WHERE tg.user_id = ?
           )
           SELECT id FROM descendants
         )`
      ).bind(userId, groupId, userId, userId),
    ])

    await emitSyncChange(c.env.DB, userId, 'tab_group', groupId, 'delete')

    return success({ message: 'Tab group permanently deleted' })
  } catch (error) {
    console.error('Permanent delete tab group error:', error)
    return internalError('Failed to permanently delete tab group')
  }
}

/** POST /:id/restore — restore a trashed tab group. */
export async function restoreTabGroupHandler(c: Context<AppEnv>): Promise<Response> {
  const auth = c.get('auth')
  if (!auth) return internalError('User not found')
  const userId = auth.user_id
  const groupId = c.req.param('id')
  if (!groupId) return notFound('Tab group not found')

  try {
    const group = await c.env.DB
      .prepare('SELECT id, user_id, is_deleted FROM tab_groups WHERE id = ? AND user_id = ?')
      .bind(groupId, userId)
      .first<TabGroupStateRow>()
    if (!group) return notFound('Tab group not found')
    if (group.is_deleted !== 1) {
      return success({ message: 'Tab group is not in trash' })
    }

    // Restoring drops the parent back to the root (NULL) when the original
    // parent is missing or itself deleted, so no group re-enters the tree
    // pointing at a trashed ancestor.
    await c.env.DB
      .prepare(
        `UPDATE tab_groups
         SET is_deleted = 0,
             deleted_at = NULL,
             parent_id = CASE
               WHEN parent_id IS NOT NULL AND NOT EXISTS (
                 SELECT 1 FROM tab_groups p
                 WHERE p.id = tab_groups.parent_id
                   AND p.user_id = ?
                   AND (p.is_deleted IS NULL OR p.is_deleted = 0)
               ) THEN NULL
               ELSE parent_id
             END,
             updated_at = ?
         WHERE id = ? AND user_id = ?`
      )
      .bind(userId, new Date().toISOString(), groupId, userId)
      .run()

    await emitSyncChange(c.env.DB, userId, 'tab_group', groupId, 'upsert')

    return success({ message: 'Tab group restored successfully' })
  } catch (error) {
    console.error('Restore tab group error:', error)
    return internalError('Failed to restore tab group')
  }
}
