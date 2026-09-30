import type { Context } from 'hono'
import type { AppEnv } from '../../lib/env'
import { badRequest, internalError, success } from '../../lib/response'
import { chunkForD1In } from '../../lib/d1-chunk'
import { emitSyncChanges } from '../../lib/sync/sync-emit'

interface BatchUpdateItem {
  id: string
  position: number
  parent_id?: string | null
}

interface BatchUpdateRequest {
  updates: BatchUpdateItem[]
}

/** PATCH /batch-update — batch update tab group positions/parents (max 200). */
export async function batchUpdateTabGroupsHandler(c: Context<AppEnv>): Promise<Response> {
  const auth = c.get('auth')
  if (!auth) return internalError('User not found')
  const userId = auth.user_id

  try {
    const body = await c.req.json<BatchUpdateRequest>()

    if (!body.updates || !Array.isArray(body.updates) || body.updates.length === 0) {
      return badRequest('updates array is required')
    }
    if (body.updates.length > 200) {
      return badRequest('Cannot update more than 200 items at once')
    }
    for (const item of body.updates) {
      if (typeof item.id !== 'string' || typeof item.position !== 'number') {
        return badRequest('Invalid update item')
      }
    }

    const db = c.env.DB
    const now = new Date().toISOString()

    // 契约语义:省略 parent_id = 保持原父级不变;显式传 null 才置回根。
    // 先读回所有目标行,以便 (a) 校验归属、(b) parent_id 缺失时沿用原值、
    // (c) 树环检测(父级不能是自身或其任一后代)。
    const ids = body.updates.map((u) => u.id)
    // D1 caps bound parameters at 100/query: 200 ids + user_id used to 500
    // before any write. Chunk the read-back and merge.
    const rowById = new Map<string, { id: string; parent_id: string | null }>()
    for (const chunk of chunkForD1In(ids, 1)) {
      const placeholders = chunk.map(() => '?').join(',')
      const { results: rows } = await db
        .prepare(`SELECT id, parent_id FROM tab_groups WHERE id IN (${placeholders}) AND user_id = ?`)
        .bind(...chunk, userId)
        .all<{ id: string; parent_id: string | null }>()
      for (const row of rows || []) rowById.set(row.id, row)
    }

    const missing = ids.filter((id) => !rowById.has(id))
    if (missing.length > 0) return badRequest('Tab group not found')

    // 校验所有非空 parent 属于当前用户(跨用户 parent 会破坏树)。
    const parentIds = [...new Set(body.updates.map((u) => u.parent_id).filter((p): p is string => p != null))]
    for (const pid of parentIds) {
      const parent = await db
        .prepare('SELECT id FROM tab_groups WHERE id = ? AND user_id = ?')
        .bind(pid, userId)
        .first<{ id: string }>()
      if (!parent) return badRequest('Parent tab group not found')
    }

    // 树环防护:对每个显式设置的非空 parent,沿 parent_id 链向上最多 64 层,
    // 遇到该组自身即拒绝(否则树遍历/递归删除会死循环)。
    for (const item of body.updates) {
      if (item.parent_id == null) continue
      if (item.parent_id === item.id) return badRequest('A tab group cannot be its own parent')
      let current: string | null = item.parent_id
      for (let depth = 0; depth < 64 && current; depth += 1) {
        if (current === item.id) return badRequest('Cannot move a tab group under its own descendant')
        const parentRow: { parent_id: string | null } | null = await db
          .prepare('SELECT parent_id FROM tab_groups WHERE id = ? AND user_id = ?')
          .bind(current, userId)
          .first<{ parent_id: string | null }>()
        current = parentRow?.parent_id ?? null
      }
    }

    const stmts = body.updates.map((item) => {
      const row = rowById.get(item.id)
      const parentId = item.parent_id === undefined ? (row?.parent_id ?? null) : item.parent_id
      return db
        .prepare(
          `UPDATE tab_groups
           SET position = ?, parent_id = ?, updated_at = ?
           WHERE id = ? AND user_id = ?`
        )
        .bind(item.position, parentId, now, item.id, userId)
    })

    await db.batch(stmts)

    // This is the web drag-reorder path: without a change record per affected
    // group the extension's incremental pull never sees position/parent updates
    // (they would only converge on the next bootstrap, up to 24h later).
    await emitSyncChanges(db, userId, 'tab_group', ids, 'upsert')

    return success({
      message: 'Batch update successful',
      updated_count: body.updates.length,
    })
  } catch (error) {
    console.error('Batch update tab groups error:', error)
    return internalError('Failed to batch update tab groups')
  }
}