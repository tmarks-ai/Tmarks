import type { Context } from 'hono'
import type { AppEnv } from '../../lib/env'
import { badRequest, forbidden, internalError, notFound, success } from '../../lib/response'
import { normalizeTabGroupItem } from '../../lib/tab-groups'
import { sanitizeString } from '../../lib/validation'
import { emitSyncChange } from '../../lib/sync/sync-emit'

interface TabGroupItemRow {
  id: string
  group_id: string
  title: string
  url: string
  favicon: string | null
  position: number
  created_at: string
  is_pinned?: number
  is_todo?: number
  is_archived?: number
  is_locked?: number
}

interface TabGroupItemOwnedRow extends TabGroupItemRow {
  user_id: string
  group_is_locked?: number
}

interface UpdateTabGroupItemRequest {
  title?: string
  is_pinned?: boolean
  is_todo?: boolean
  is_archived?: boolean
  position?: number
  is_locked?: boolean
}

async function fetchOwnedItem(
  db: D1Database,
  itemId: string
): Promise<TabGroupItemOwnedRow | null> {
  return db
    .prepare(
      `SELECT tgi.*, tg.user_id, tg.is_locked as group_is_locked
       FROM tab_group_items tgi
       JOIN tab_groups tg ON tgi.group_id = tg.id
       WHERE tgi.id = ? AND (tg.is_deleted IS NULL OR tg.is_deleted = 0)`
    )
    .bind(itemId)
    .first<TabGroupItemOwnedRow>()
}

/** PATCH /items/:itemId — update a tab-group item (pinning shifts siblings). */
export async function updateTabGroupItemHandler(c: Context<AppEnv>): Promise<Response> {
  const auth = c.get('auth')
  if (!auth) return internalError('User not found')
  const userId = auth.user_id
  const itemId = c.req.param('itemId')
  if (!itemId) return notFound('Tab group item not found')

  try {
    const body = await c.req.json<UpdateTabGroupItemRequest>()
    const item = await fetchOwnedItem(c.env.DB, itemId)
    if (!item || item.user_id !== userId) return notFound('Tab group item not found')

    // A locked group blocks all item mutations; a locked item only allows unlocking itself.
    if (item.group_is_locked) return forbidden('Tab group is locked', 'RESOURCE_LOCKED')
    if (item.is_locked && body.is_locked !== false) {
      return forbidden('Tab group item is locked', 'RESOURCE_LOCKED')
    }

    const updates: string[] = []
    const params: Array<string | number> = []
    // Sibling shift (pinning) must land atomically with the main UPDATE.
    const preStatements: D1PreparedStatement[] = []

    if (body.title !== undefined) {
      updates.push('title = ?')
      params.push(sanitizeString(body.title, 500))
    }
    if (body.is_pinned !== undefined) {
      updates.push('is_pinned = ?')
      params.push(body.is_pinned ? 1 : 0)
      // When pinning, send this item to the front and shift the rest down.
      if (body.is_pinned) {
        preStatements.push(
          c.env.DB
            .prepare('UPDATE tab_group_items SET position = position + 1 WHERE group_id = ? AND id != ?')
            .bind(item.group_id, itemId)
        )
        updates.push('position = ?')
        params.push(0)
      }
    }
    if (body.is_todo !== undefined) {
      updates.push('is_todo = ?')
      params.push(body.is_todo ? 1 : 0)
    }
    if (body.is_archived !== undefined) {
      updates.push('is_archived = ?')
      params.push(body.is_archived ? 1 : 0)
    }
    if (body.position !== undefined) {
      updates.push('position = ?')
      params.push(body.position)
    }
    if (body.is_locked !== undefined) {
      updates.push('is_locked = ?')
      params.push(body.is_locked ? 1 : 0)
    }
    if (updates.length === 0) return badRequest('No fields to update')

    params.push(itemId, item.group_id, userId)
    await c.env.DB.batch([
      ...preStatements,
      c.env.DB
        .prepare(
          `UPDATE tab_group_items SET ${updates.join(', ')}
           WHERE id = ? AND group_id IN (SELECT id FROM tab_groups WHERE id = ? AND user_id = ?)`
        )
        .bind(...params),
    ])

    const updatedItem = await c.env.DB
      .prepare(
        `SELECT tgi.* FROM tab_group_items tgi
         JOIN tab_groups tg ON tgi.group_id = tg.id
         WHERE tgi.id = ? AND tg.user_id = ? AND (tg.is_deleted IS NULL OR tg.is_deleted = 0)`
      )
      .bind(itemId, userId)
      .first<TabGroupItemRow>()
    if (!updatedItem) return internalError('Failed to load item after update')

    await emitSyncChange(c.env.DB, userId, 'tab_group', item.group_id, 'upsert')

    return success({ item: normalizeTabGroupItem(updatedItem), message: 'Item updated successfully' })
  } catch (error) {
    console.error('Update tab group item error:', error)
    return internalError('Failed to update tab group item')
  }
}

/** DELETE /items/:itemId — delete a tab-group item and compact positions. */
export async function deleteTabGroupItemHandler(c: Context<AppEnv>): Promise<Response> {
  const auth = c.get('auth')
  if (!auth) return internalError('User not found')
  const userId = auth.user_id
  const itemId = c.req.param('itemId')
  if (!itemId) return notFound('Tab group item not found')

  try {
    const item = await fetchOwnedItem(c.env.DB, itemId)
    if (!item || item.user_id !== userId) return notFound('Tab group item not found')
    if (item.group_is_locked || item.is_locked) {
      return forbidden('Tab group item is locked', 'RESOURCE_LOCKED')
    }

    // Delete + position compaction in one batch: a failure between the two
    // left a position gap that never healed.
    await c.env.DB.batch([
      c.env.DB
        .prepare(
          'DELETE FROM tab_group_items WHERE id = ? AND group_id IN (SELECT id FROM tab_groups WHERE id = ? AND user_id = ?)'
        )
        .bind(itemId, item.group_id, userId),
      c.env.DB
        .prepare('UPDATE tab_group_items SET position = position - 1 WHERE group_id = ? AND position > ?')
        .bind(item.group_id, item.position),
    ])

    await emitSyncChange(c.env.DB, userId, 'tab_group', item.group_id, 'upsert')

    return success({ message: 'Item deleted successfully' })
  } catch (error) {
    console.error('Delete tab group item error:', error)
    return internalError('Failed to delete tab group item')
  }
}
