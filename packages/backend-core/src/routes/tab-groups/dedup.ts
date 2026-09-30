import type { Context } from 'hono'
import type { AppEnv } from '../../lib/env'
import { forbidden, internalError, notFound, success } from '../../lib/response'
import { normalizeBookmarkUrl } from '../../lib/bookmarks/bookmark-url'
import { chunkForD1In } from '../../lib/d1-chunk'
import { emitSyncChange } from '../../lib/sync/sync-emit'

interface DedupRequest {
  dry_run?: boolean
}

interface DedupItemRow {
  id: string
  url: string
  position: number
  created_at: string
}

interface DedupDuplicate {
  url: string
  kept_id: string
  removed_ids: string[]
}

/** POST /:id/dedup — 扫描组内条目,按规范化 URL 去重,保留最早创建的条目,删除其余重复项。dry_run=true 仅预览不删除。 */
export async function dedupTabGroupHandler(c: Context<AppEnv>): Promise<Response> {
  const auth = c.get('auth')
  if (!auth) return internalError('User not found')
  const userId = auth.user_id
  const groupId = c.req.param('id')
  if (!groupId) return notFound('Tab group not found')

  try {
    let body: DedupRequest = {}
    try {
      body = await c.req.json<DedupRequest>()
    } catch {
      // body 可选;缺省执行真实删除。
    }
    const dryRun = body.dry_run === true

    const group = await c.env.DB
      .prepare(
        'SELECT is_locked FROM tab_groups WHERE id = ? AND user_id = ? AND (is_deleted IS NULL OR is_deleted = 0)'
      )
      .bind(groupId, userId)
      .first<{ is_locked?: number }>()
    if (!group) return notFound('Tab group not found')
    if (group.is_locked) return forbidden('Tab group is locked', 'RESOURCE_LOCKED')

    const { results } = await c.env.DB
      .prepare(
        'SELECT id, url, position, created_at FROM tab_group_items WHERE group_id = ? ORDER BY created_at ASC, position ASC'
      )
      .bind(groupId)
      .all<DedupItemRow>()

    const byUrl = new Map<string, DedupDuplicate>()
    for (const item of results || []) {
      // 与书签侧共用 normalizeBookmarkUrl,保证两端归一化口径一致。
      const key = normalizeBookmarkUrl(item.url)
      const existing = byUrl.get(key)
      if (existing) existing.removed_ids.push(item.id)
      else byUrl.set(key, { url: item.url, kept_id: item.id, removed_ids: [] })
    }

    const duplicates = [...byUrl.values()].filter((d) => d.removed_ids.length > 0)
    const idsToDelete = duplicates.flatMap((d) => d.removed_ids)

    if (!dryRun && idsToDelete.length > 0) {
      // Chunked against D1's 100-bound-parameter cap (the old "500 per batch"
      // cited local SQLite's 999-variable limit — the wrong platform constant,
      // so a group with >99 duplicates failed mid-chunk in production).
      // group_id 谓词把 DELETE 锚定到已验证归属的组:即使预读结果过期,也不会波及他组条目。
      for (const chunk of chunkForD1In(idsToDelete, 1)) {
        const placeholders = chunk.map(() => '?').join(',')
        await c.env.DB
          .prepare(`DELETE FROM tab_group_items WHERE id IN (${placeholders}) AND group_id = ?`)
          .bind(...chunk, groupId)
          .run()
      }
    }

    await emitSyncChange(c.env.DB, userId, 'tab_group', groupId, 'upsert')

    return success({ removed: idsToDelete.length, duplicates })
  } catch (error) {
    console.error('Dedup tab group error:', error)
    return internalError('Failed to dedup tab group')
  }
}
