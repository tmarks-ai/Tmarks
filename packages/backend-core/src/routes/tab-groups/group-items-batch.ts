import type { Context } from 'hono'
import type { AppEnv } from '../../lib/env'
import { badRequest, internalError, notFound, success } from '../../lib/response'
import { sanitizeString, sanitizeUrl } from '../../lib/validation'
import { generateUUID } from '../../lib/crypto'
import { emitSyncChange } from '../../lib/sync/sync-emit'

interface TabGroupRefRow {
  id: string
  user_id: string
  title: string
}

interface TabGroupItemRow {
  id: string
  group_id: string
  title: string
  url: string
  favicon: string | null
  position: number
  created_at: string
}

interface BatchAddItemsRequest {
  items: Array<{ title: string; url: string; favicon?: string }>
}

// Matches the tab-group item batch ops cap; a single request with a huge
// items array would otherwise build an unbounded list of D1 statements.
const MAX_BATCH_ADD_ITEMS = 100

/** POST /:id/items/batch — append items to an existing tab group (max-position aware). */
export async function groupItemsBatchAddHandler(c: Context<AppEnv>): Promise<Response> {
  const auth = c.get('auth')
  if (!auth) return internalError('User not found')
  const userId = auth.user_id
  const groupId = c.req.param('id')
  if (!groupId) return notFound('Tab group not found')

  try {
    const body = await c.req.json<BatchAddItemsRequest>()
    if (!body.items || !Array.isArray(body.items) || body.items.length === 0) {
      return badRequest('items array is required and must not be empty')
    }
    if (body.items.length > MAX_BATCH_ADD_ITEMS) {
      return badRequest(`Maximum ${MAX_BATCH_ADD_ITEMS} items per batch`)
    }

    const group = await c.env.DB
      .prepare(
        'SELECT id, user_id, title FROM tab_groups WHERE id = ? AND user_id = ? AND (is_deleted IS NULL OR is_deleted = 0)'
      )
      .bind(groupId, userId)
      .first<TabGroupRefRow>()
    if (!group) return notFound('Tab group not found')

    const maxPositionResult = await c.env.DB
      .prepare('SELECT MAX(position) as max_position FROM tab_group_items WHERE group_id = ?')
      .bind(groupId)
      .first<{ max_position: number | null }>()
    let currentPosition = (maxPositionResult?.max_position ?? -1) + 1

    const insertedItems: TabGroupItemRow[] = []
    const stmts: D1PreparedStatement[] = []
    const now = new Date().toISOString()

    for (const item of body.items) {
      if (!item.url || !item.title) continue // skip invalid items
      const sanitizedUrl = sanitizeUrl(item.url)
      if (!sanitizedUrl) continue // skip non-http(s) URLs
      const itemId = generateUUID()
      const sanitizedTitle = sanitizeString(item.title, 500)
      const sanitizedFavicon = item.favicon ? sanitizeString(item.favicon, 2000) : null

      stmts.push(
        c.env.DB
          .prepare(
            `INSERT INTO tab_group_items (id, group_id, title, url, favicon, position, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)`
          )
          .bind(itemId, groupId, sanitizedTitle, sanitizedUrl, sanitizedFavicon, currentPosition, now)
      )
      insertedItems.push({
        id: itemId,
        group_id: groupId,
        title: sanitizedTitle,
        url: sanitizedUrl,
        favicon: sanitizedFavicon,
        position: currentPosition,
        created_at: now,
      })
      currentPosition++
    }

    if (stmts.length > 0) await c.env.DB.batch(stmts)

    await emitSyncChange(c.env.DB, userId, 'tab_group', groupId, 'upsert')

    return success({
      message: 'Items added successfully',
      added_count: insertedItems.length,
      total_items: currentPosition,
      items: insertedItems,
    })
  } catch (error) {
    console.error('Batch add items error:', error)
    return internalError('Failed to add items to group')
  }
}
