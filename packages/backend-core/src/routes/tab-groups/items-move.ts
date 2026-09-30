import type { Context } from 'hono'
import type { AppEnv } from '../../lib/env'
import { badRequest, forbidden, internalError, notFound, success } from '../../lib/response'
import { normalizeTabGroupItem } from '../../lib/tab-groups'
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
  is_locked?: number
}

interface TabGroupItemOwnedRow extends TabGroupItemRow {
  user_id: string
  group_is_locked?: number
}

interface MoveItemRequest {
  target_group_id: string
  position?: number
}

/** POST /items/:itemId/move — move an item within or across the caller's tab groups. */
export async function moveTabGroupItemHandler(c: Context<AppEnv>): Promise<Response> {
  const auth = c.get('auth')
  if (!auth) return internalError('User not found')
  const userId = auth.user_id
  const itemId = c.req.param('itemId')
  if (!itemId) return notFound('Tab group item not found')

  try {
    const body = await c.req.json<MoveItemRequest>()
    if (typeof body.target_group_id !== 'string' || !body.target_group_id) {
      return badRequest('target_group_id is required')
    }
    if (
      body.position !== undefined &&
      (typeof body.position !== 'number' || !Number.isInteger(body.position) || body.position < 0)
    ) {
      return badRequest('position must be a non-negative integer')
    }

    const item = await c.env.DB
      .prepare(
        `SELECT tgi.*, tg.user_id, tg.is_locked as group_is_locked
         FROM tab_group_items tgi
         JOIN tab_groups tg ON tgi.group_id = tg.id
         WHERE tgi.id = ? AND (tg.is_deleted IS NULL OR tg.is_deleted = 0)`
      )
      .bind(itemId)
      .first<TabGroupItemOwnedRow>()
    if (!item || item.user_id !== userId) return notFound('Tab group item not found')

    const targetGroup = await c.env.DB
      .prepare(
        'SELECT id, user_id, is_locked FROM tab_groups WHERE id = ? AND user_id = ? AND (is_deleted IS NULL OR is_deleted = 0)'
      )
      .bind(body.target_group_id, userId)
      .first<{ id: string; user_id: string; is_locked?: number }>()
    if (!targetGroup) return notFound('Target group not found')

    // Locked items, locked source group, or locked target group reject moves.
    if (item.is_locked || item.group_is_locked || targetGroup.is_locked) {
      return forbidden('Tab group item is locked', 'RESOURCE_LOCKED')
    }

    if (item.group_id === body.target_group_id) {
      // Reorder within the same group. One batch: two separate .run() calls
      // left duplicate positions behind on partial failure.
      if (body.position !== undefined) {
        await c.env.DB.batch([
          // The bare-PK UPDATEs below carry an ownership subquery as
          // defense in depth: the item row was ownership-checked at load, but
          // the write itself should not trust that read indefinitely.
          c.env.DB.prepare(
            'UPDATE tab_group_items SET position = ? WHERE id = ? AND group_id IN (SELECT id FROM tab_groups WHERE user_id = ?)'
          )
            .bind(body.position, itemId, userId),
          c.env.DB.prepare(
            `UPDATE tab_group_items SET position = position + 1
             WHERE group_id = ? AND id != ? AND position >= ?`
          )
            .bind(item.group_id, itemId, body.position),
        ])
      }
    } else {
      // Move across groups.
      const maxPositionResult = await c.env.DB
        .prepare('SELECT MAX(position) as max_position FROM tab_group_items WHERE group_id = ?')
        .bind(body.target_group_id)
        .first<{ max_position: number | null }>()
      const targetPosition =
        body.position !== undefined ? body.position : (maxPositionResult?.max_position ?? -1) + 1

      // Move + source compaction (+ target shift when an explicit slot was
      // requested) form one atomic sequence, mirroring batch-update/reorder.
      const statements: D1PreparedStatement[] = [
        c.env.DB.prepare(
          'UPDATE tab_group_items SET group_id = ?, position = ? WHERE id = ? AND group_id IN (SELECT id FROM tab_groups WHERE user_id = ?)'
        )
          .bind(body.target_group_id, targetPosition, itemId, userId),
        c.env.DB.prepare('UPDATE tab_group_items SET position = position - 1 WHERE group_id = ? AND position > ?')
          .bind(item.group_id, item.position),
      ]
      if (body.position !== undefined) {
        statements.push(
          c.env.DB.prepare(
            `UPDATE tab_group_items SET position = position + 1
             WHERE group_id = ? AND id != ? AND position >= ?`
          )
            .bind(body.target_group_id, itemId, targetPosition)
        )
      }
      await c.env.DB.batch(statements)
    }

    const updatedItem = await c.env.DB
      .prepare(
        `SELECT tgi.* FROM tab_group_items tgi
         JOIN tab_groups tg ON tgi.group_id = tg.id
         WHERE tgi.id = ? AND tg.user_id = ? AND (tg.is_deleted IS NULL OR tg.is_deleted = 0)`
      )
      .bind(itemId, userId)
      .first<TabGroupItemRow>()
    if (!updatedItem) return internalError('Failed to load item after move')

    // Both the source and the target group changed.
    await emitSyncChange(c.env.DB, userId, 'tab_group', item.group_id, 'upsert')
    if (body.target_group_id && body.target_group_id !== item.group_id) {
      await emitSyncChange(c.env.DB, userId, 'tab_group', body.target_group_id, 'upsert')
    }

    return success({ item: normalizeTabGroupItem(updatedItem), message: 'Item moved successfully' })
  } catch (error) {
    console.error('Move tab group item error:', error)
    return internalError('Failed to move tab group item')
  }
}
