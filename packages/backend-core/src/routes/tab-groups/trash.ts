import type { Context } from 'hono'
import type { AppEnv } from '../../lib/env'
import { internalError, success } from '../../lib/response'
import { chunkForD1In } from '../../lib/d1-chunk'
import { normalizeTabGroup } from '../../lib/tab-groups'

interface TrashTabGroupRow {
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

/** GET /trash — list the caller's soft-deleted tab groups with item counts. */
export async function trashTabGroupsHandler(c: Context<AppEnv>): Promise<Response> {
  const auth = c.get('auth')
  if (!auth) return internalError('User not found')
  const userId = auth.user_id

  try {
    const { results: groups } = await c.env.DB
      .prepare(
        'SELECT * FROM tab_groups WHERE user_id = ? AND is_deleted = 1 ORDER BY deleted_at DESC'
      )
      .bind(userId)
      .all<TrashTabGroupRow>()

    // Single IN query per chunk for all item counts (avoids N+1 per group).
    // The trash list is unpaginated, so >99 trashed groups used to 500 —
    // chunk against D1's 100-bound-parameter cap.
    const groupRows = groups || []
    const countsByGroup = new Map<string, number>()
    const groupIds = groupRows.map((group) => group.id)
    if (groupIds.length > 0) {
      for (const chunk of chunkForD1In(groupIds, 0)) {
        const placeholders = chunk.map(() => '?').join(',')
        const { results: counts } = await c.env.DB
          .prepare(
            `SELECT group_id, COUNT(*) as count FROM tab_group_items
             WHERE group_id IN (${placeholders}) GROUP BY group_id`
          )
          .bind(...chunk)
          .all<{ group_id: string; count: number }>()
        for (const row of counts || []) countsByGroup.set(row.group_id, Number(row.count || 0))
      }
    }

    const groupsWithCounts = groupRows.map((group) =>
      normalizeTabGroup(group, undefined, countsByGroup.get(group.id) || 0),
    )

    return success({
      tab_groups: groupsWithCounts,
      total: groupsWithCounts.length,
    })
  } catch (error) {
    console.error('Get trash tab groups error:', error)
    return internalError('Failed to load trash')
  }
}
