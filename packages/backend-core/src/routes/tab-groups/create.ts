import type { Context } from 'hono'
import type { AppEnv } from '../../lib/env'
import { badRequest, created, internalError } from '../../lib/response'
import { normalizeTabGroup } from '../../lib/tab-groups'
import { sanitizeString, sanitizeUrl } from '../../lib/validation'
import { generateUUID } from '../../lib/crypto'
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

interface CreateTabGroupRequest {
  title?: string
  parent_id?: string | null
  is_folder?: boolean
  items?: Array<{ title: string; url: string; favicon?: string }>
}

function defaultTabGroupTitle(isFolder: boolean): string {
  if (isFolder) return ''
  const now = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(
    now.getHours()
  )}:${pad(now.getMinutes())}`
}

/** POST / — create a tab group (optionally a folder) with optional initial items. */
export async function createTabGroupHandler(c: Context<AppEnv>): Promise<Response> {
  const auth = c.get('auth')
  if (!auth) return internalError('User not found')
  const userId = auth.user_id

  try {
    const body = await c.req.json<CreateTabGroupRequest>()
    const isFolder = body.is_folder || false
    const title = sanitizeString(body.title || defaultTabGroupTitle(isFolder), 200)

    const groupId = generateUUID()
    const timestamp = new Date().toISOString()
    const parentId = body.parent_id || null

    // 父组必须属于当前用户:跨用户 parent 会破坏树结构,并可能经列表泄露目标组标题。
    if (parentId) {
      const parent = await c.env.DB
        .prepare('SELECT id FROM tab_groups WHERE id = ? AND user_id = ?')
        .bind(parentId, userId)
        .first<{ id: string }>()
      if (!parent) return badRequest('Parent tab group not found')
    }

    const items = body.items ?? []
    if (items.length > 100) return badRequest('Too many items (max 100)')

    const stmts = [
      c.env.DB.prepare(
        'INSERT INTO tab_groups (id, user_id, title, parent_id, is_folder, is_deleted, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 0, ?, ?)'
      ).bind(groupId, userId, title, parentId, isFolder ? 1 : 0, timestamp, timestamp),
    ]

    if (!isFolder && items.length > 0) {
      for (let i = 0; i < items.length; i++) {
        const item = items[i]
        const safeUrl = sanitizeUrl(item.url)
        if (!safeUrl) continue // skip items whose URL is not http(s)
        const itemId = generateUUID()
        stmts.push(
          c.env.DB.prepare(
            'INSERT INTO tab_group_items (id, group_id, title, url, favicon, position, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
          ).bind(
            itemId,
            groupId,
            sanitizeString(item.title, 500),
            safeUrl,
            item.favicon ? sanitizeString(item.favicon, 2000) : null,
            i,
            timestamp
          )
        )
      }
    }

    await c.env.DB.batch(stmts)

    const groupRow = await c.env.DB
      .prepare('SELECT * FROM tab_groups WHERE id = ?')
      .bind(groupId)
      .first<TabGroupRow>()
    if (!groupRow) return internalError('Failed to load tab group after creation')

    const { results: itemRows } = await c.env.DB.prepare(
      `SELECT tgi.*
       FROM tab_group_items tgi
       JOIN tab_groups tg ON tgi.group_id = tg.id
       WHERE tgi.group_id = ? AND tg.user_id = ?
       ORDER BY tgi.position ASC`
    )
      .bind(groupId, userId)
      .all<TabGroupItemRow>()

    await emitSyncChange(c.env.DB, userId, 'tab_group', groupId, 'upsert')

    return created({
      tab_group: normalizeTabGroup(groupRow, itemRows || []),
    })
  } catch (error) {
    console.error('Create tab group error:', error)
    return internalError('Failed to create tab group')
  }
}
