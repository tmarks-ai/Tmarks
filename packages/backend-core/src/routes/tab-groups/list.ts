import type { Context } from 'hono'
import type { AppEnv } from '../../lib/env'
import { internalError, success } from '../../lib/response'
import { chunkForD1In } from '../../lib/d1-chunk'
import { normalizeTabGroup } from '../../lib/tab-groups'

interface TabGroupRow {
  id: string
  user_id: string
  title: string
  color: string | null
  tags: string | null
  parent_id: string | null
  is_folder: number
  is_deleted: number
  deleted_at: string | null
  position: number
  created_at: string
  updated_at: string
}

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
}

/** GET / — cursor-paginated list of the caller's tab groups with items (newest first). */
export async function listTabGroupsHandler(c: Context<AppEnv>): Promise<Response> {
  const auth = c.get('auth')
  if (!auth) return internalError('User not found')
  const userId = auth.user_id

  const url = new URL(c.req.url)
  const pageSize = Math.max(1, Math.min(parseInt(url.searchParams.get('page_size') || '30', 10) || 30, 100))
  const pageCursor = url.searchParams.get('page_cursor') || ''

  // Cursor packs `created_at|id`. The timestamp alone silently skipped whole
  // pages of ties (bulk import / extension sync batches share a millisecond);
  // the id tiebreaker matches the bookmarks list and trash cursors. A legacy
  // bare-timestamp cursor still works (falls back to the timestamp predicate).
  let cursorCreatedAt = ''
  let cursorId = ''
  if (pageCursor.includes('|')) {
    const [createdAt, id] = pageCursor.split('|')
    cursorCreatedAt = createdAt ?? ''
    cursorId = id ?? ''
  } else if (pageCursor) {
    cursorCreatedAt = pageCursor
  }

  try {
    let query = `
      SELECT * FROM tab_groups
      WHERE user_id = ? AND (is_deleted IS NULL OR is_deleted = 0)`
    const params: Array<string | number> = [userId]

    if (cursorCreatedAt) {
      if (cursorId) {
        query += ' AND (created_at < ? OR (created_at = ? AND id < ?))'
        params.push(cursorCreatedAt, cursorCreatedAt, cursorId)
      } else {
        query += ' AND created_at < ?'
        params.push(cursorCreatedAt)
      }
    }
    query += ' ORDER BY created_at DESC, id DESC LIMIT ?'
    params.push(pageSize + 1)

    const { results } = await c.env.DB.prepare(query).bind(...params).all<TabGroupRow>()
    const rows = results || []
    const hasMore = rows.length > pageSize
    const tabGroups = hasMore ? rows.slice(0, pageSize) : rows
    const lastRow = tabGroups[tabGroups.length - 1]
    const nextCursor = hasMore && lastRow ? `${lastRow.created_at}|${lastRow.id}` : null

    // Batch-fetch items for all returned groups (avoids N+1). Chunked
    // against D1's 100-bound-parameter cap: a full 100-group page + user_id
    // used to 500.
    const groupIds = tabGroups.map((g) => g.id)
    let allItems: TabGroupItemRow[] = []
    for (const chunk of chunkForD1In(groupIds, 1)) {
      const placeholders = chunk.map(() => '?').join(',')
      const { results: items } = await c.env.DB.prepare(
        `SELECT tgi.*
         FROM tab_group_items tgi
         JOIN tab_groups tg ON tgi.group_id = tg.id
         WHERE tgi.group_id IN (${placeholders}) AND tg.user_id = ?
         ORDER BY COALESCE(tgi.is_pinned, 0) DESC, tgi.position ASC`
      )
        .bind(...chunk, userId)
        .all<TabGroupItemRow>()
      allItems = allItems.concat(items || [])
    }

    const itemsByGroup = new Map<string, TabGroupItemRow[]>()
    for (const item of allItems) {
      const arr = itemsByGroup.get(item.group_id) || []
      arr.push(item)
      itemsByGroup.set(item.group_id, arr)
    }

    const groupsWithItems = tabGroups.map((group) =>
      normalizeTabGroup(group, itemsByGroup.get(group.id) || []),
    )

    // meta nested in data so count/has_more/nullable next_cursor stay client-visible
    // (mirrors the bookmarks list envelope).
    return success({
      tab_groups: groupsWithItems,
      meta: {
        page_size: pageSize,
        count: tabGroups.length,
        next_cursor: nextCursor,
        has_more: hasMore,
      },
    })
  } catch (error) {
    console.error('Get tab groups error:', error)
    return internalError('Failed to get tab groups')
  }
}
