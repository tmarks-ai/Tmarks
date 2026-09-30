import type { Context } from 'hono'
import type { AppEnv } from '../../lib/env'
import { badRequest, forbidden, internalError, noContent, notFound, success } from '../../lib/response'
import { normalizeTabGroup } from '../../lib/tab-groups'
import { sanitizeColor, sanitizeString } from '../../lib/validation'
import { emitSyncChange } from '../../lib/sync/sync-emit'

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
  is_locked?: number
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

interface UpdateTabGroupRequest {
  title?: string
  color?: string | null
  tags?: string[] | null
  parent_id?: string | null
  position?: number
  is_locked?: boolean
}

async function loadGroupWithItems(
  db: D1Database,
  groupId: string,
  userId: string,
  pinnedFirst: boolean
) {
  const groupRow = await db
    .prepare(
      'SELECT * FROM tab_groups WHERE id = ? AND user_id = ? AND (is_deleted IS NULL OR is_deleted = 0)'
    )
    .bind(groupId, userId)
    .first<TabGroupRow>()
  if (!groupRow) return null

  const order = pinnedFirst
    ? 'COALESCE(tgi.is_pinned, 0) DESC, tgi.position ASC'
    : 'tgi.position ASC'
  const { results: items } = await db
    .prepare(
      `SELECT tgi.*
       FROM tab_group_items tgi
       JOIN tab_groups tg ON tgi.group_id = tg.id
       WHERE tgi.group_id = ? AND tg.user_id = ?
       ORDER BY ${order}`
    )
    .bind(groupId, userId)
    .all<TabGroupItemRow>()

  return normalizeTabGroup(groupRow, items || [])
}

/** GET /:id — a single tab group with its items. */
export async function getTabGroupHandler(c: Context<AppEnv>): Promise<Response> {
  const auth = c.get('auth')
  if (!auth) return internalError('User not found')
  const userId = auth.user_id
  const groupId = c.req.param('id')
  if (!groupId) return notFound('Tab group not found')

  try {
    const tabGroup = await loadGroupWithItems(c.env.DB, groupId, userId, true)
    if (!tabGroup) return notFound('Tab group not found')
    return success({ tab_group: tabGroup })
  } catch (error) {
    console.error('Get tab group error:', error)
    return internalError('Failed to get tab group')
  }
}

/** PATCH /:id — update tab group fields. */
export async function updateTabGroupHandler(c: Context<AppEnv>): Promise<Response> {
  const auth = c.get('auth')
  if (!auth) return internalError('User not found')
  const userId = auth.user_id
  const groupId = c.req.param('id')
  if (!groupId) return notFound('Tab group not found')

  try {
    let body: UpdateTabGroupRequest
    try {
      body = await c.req.json<UpdateTabGroupRequest>()
    } catch (parseError) {
      return badRequest(
        'Invalid request body: ' +
          (parseError instanceof Error ? parseError.message : 'JSON parse error')
      )
    }

    const groupRow = await c.env.DB
      .prepare(
        'SELECT * FROM tab_groups WHERE id = ? AND user_id = ? AND (is_deleted IS NULL OR is_deleted = 0)'
      )
      .bind(groupId, userId)
      .first<TabGroupRow>()
    if (!groupRow) return notFound('Tab group not found')

    // Locked groups reject all mutations except the unlock operation itself.
    if (groupRow.is_locked && body.is_locked !== false) {
      return forbidden('Tab group is locked', 'RESOURCE_LOCKED')
    }

    const updates: string[] = []
    const params: Array<string | number | null> = []

    if (body.title !== undefined) {
      updates.push('title = ?')
      params.push(sanitizeString(body.title, 200))
    }
    if (body.parent_id !== undefined) {
      // Reject pointing the parent at another user's (or a missing) group; a
      // cross-user parent would corrupt the tree and could leak the target
      // group's title via listings.
      if (body.parent_id !== null) {
        if (body.parent_id === groupId) return badRequest('A tab group cannot be its own parent')
        const parent = await c.env.DB
          .prepare('SELECT id FROM tab_groups WHERE id = ? AND user_id = ?')
          .bind(body.parent_id, userId)
          .first<{ id: string }>()
        if (!parent) return badRequest('Parent tab group not found')
        // Tree cycle guard: the new parent must not sit below this group,
        // otherwise parent-chain walks (and recursive deletes) loop forever.
        if (await isDescendantOf(c.env.DB, userId, groupId, body.parent_id)) {
          return badRequest('Cannot move a tab group under its own descendant')
        }
      }
      updates.push('parent_id = ?')
      params.push(body.parent_id)
    }
    if (body.position !== undefined) {
      updates.push('position = ?')
      params.push(body.position)
    }
    if (body.color !== undefined) {
      updates.push('color = ?')
      params.push(sanitizeColor(body.color))
    }
    if (body.tags !== undefined) {
      // Bound the stored JSON: ≤50 items, each ≤50 chars (tag names) — the
      // column accepted unbounded content before.
      const tags = body.tags && Array.isArray(body.tags)
        ? body.tags.slice(0, 50).map((tag) => String(tag).slice(0, 50))
        : body.tags
      updates.push('tags = ?')
      params.push(tags ? JSON.stringify(tags) : null)
    }
    if (body.is_locked !== undefined) {
      updates.push('is_locked = ?')
      params.push(body.is_locked ? 1 : 0)
    }
    if (updates.length === 0) return badRequest('No valid fields to update')

    updates.push('updated_at = ?')
    params.push(new Date().toISOString(), groupId, userId)

    await c.env.DB
      .prepare(`UPDATE tab_groups SET ${updates.join(', ')} WHERE id = ? AND user_id = ?`)
      .bind(...params)
      .run()

    await emitSyncChange(c.env.DB, userId, 'tab_group', groupId, 'upsert')

    const tabGroup = await loadGroupWithItems(c.env.DB, groupId, userId, false)
    if (!tabGroup) return internalError('Failed to load tab group after update')
    return success({ tab_group: tabGroup })
  } catch (error) {
    console.error('Update tab group error:', error)
    return internalError('Failed to update tab group')
  }
}

/**
 * True when `ancestorId` appears on the parent chain above `startId` (bounded
 * at 64 hops). Used to reject moving a group under its own descendant, which
 * would create a cycle in the tab_groups tree.
 */
async function isDescendantOf(
  db: D1Database,
  userId: string,
  ancestorId: string,
  startId: string
): Promise<boolean> {
  let current: string | null = startId
  for (let depth = 0; depth < 64 && current; depth += 1) {
    if (current === ancestorId) return true
    const row: { parent_id: string | null } | null = await db
      .prepare('SELECT parent_id FROM tab_groups WHERE id = ? AND user_id = ?')
      .bind(current, userId)
      .first<{ parent_id: string | null }>()
    current = row?.parent_id ?? null
  }
  return false
}

/** DELETE /:id — soft-delete a tab group (move to trash). */
export async function deleteTabGroupHandler(c: Context<AppEnv>): Promise<Response> {
  const auth = c.get('auth')
  if (!auth) return internalError('User not found')
  const userId = auth.user_id
  const groupId = c.req.param('id')
  if (!groupId) return notFound('Tab group not found')

  try {
    const groupRow = await c.env.DB
      .prepare(
        'SELECT * FROM tab_groups WHERE id = ? AND user_id = ? AND (is_deleted IS NULL OR is_deleted = 0)'
      )
      .bind(groupId, userId)
      .first<TabGroupRow>()
    if (!groupRow) return notFound('Tab group not found')
    if (groupRow.is_locked) return forbidden('Tab group is locked', 'RESOURCE_LOCKED')

    const now = new Date().toISOString()
    // Soft-delete the group together with every descendant (recursive CTE over
    // parent_id), mirroring the folder cascade so trashing a folder group takes
    // its whole subtree with it.
    await c.env.DB.prepare(
      `WITH RECURSIVE descendants(id) AS (
         SELECT id FROM tab_groups WHERE id = ? AND user_id = ?
         UNION
         SELECT tg.id FROM tab_groups tg
         JOIN descendants d ON tg.parent_id = d.id
         WHERE tg.user_id = ?
       )
       UPDATE tab_groups
       SET is_deleted = 1, deleted_at = ?, updated_at = ?
       WHERE user_id = ? AND (is_deleted IS NULL OR is_deleted = 0)
         AND id IN (SELECT id FROM descendants)`
    )
      .bind(groupId, userId, userId, now, now, userId)
      .run()

    await emitSyncChange(c.env.DB, userId, 'tab_group', groupId, 'delete')

    return noContent()
  } catch (error) {
    console.error('Delete tab group error:', error)
    return internalError('Failed to delete tab group')
  }
}
