import type { SyncBookmarkRow, SyncEntityRevisionRow, SyncTabGroupItemRow, SyncTagRow } from './sync-d1-types'
import { normalizeSql } from './sync-d1-utils'

/** Count/max-updated-at aggregates for /sync/summary against the in-memory store. */
export function handleSummaryAggregates<T>(
  db: {
    bookmarks: Map<string, SyncBookmarkRow>
    bookmarkFolders: Map<string, { user_id: string; is_deleted: number; updated_at: string }>
    tags: Map<string, SyncTagRow>
    tabGroups: Map<string, { user_id: string; is_deleted: number; updated_at: string }>
    tabGroupItems: Map<string, SyncTabGroupItemRow>
    entityRevisions: Map<string, SyncEntityRevisionRow>
    syncChanges: Array<{ user_id: string; id: number }>
  },
  sql: string,
  values: unknown[],
): { results: T[]; success: true } | null {
  const normalizedSql = normalizeSql(sql)

  if (normalizedSql.includes('pending') && normalizedSql.includes('from sync_changes')) {
    const userId = String(values[0])
    const afterId = values[1] === null || values[1] === undefined ? null : Number(values[1])
    const pending = afterId === null
      ? 0
      : db.syncChanges.filter((c) => c.user_id === userId && c.id > afterId).length
    return { results: [{ pending } as unknown as T], success: true }
  }

  if (normalizedSql.includes('coalesce(max(id), 0) as id from sync_changes')) {
    const userId = String(values[0])
    const id = db.syncChanges
      .filter((c) => c.user_id === userId)
      .reduce((max, c) => Math.max(max, c.id), 0)
    return { results: [{ id } as unknown as T], success: true }
  }

  const countFromRows = (rows: Array<{ updated_at: string; created_at?: string }>) => {
    let maxUpdatedAt: string | null = null
    for (const row of rows) {
      if (maxUpdatedAt === null || row.updated_at > maxUpdatedAt) maxUpdatedAt = row.updated_at
    }
    return [{ count: rows.length, max_updated_at: maxUpdatedAt } as unknown as T]
  }

  if (normalizedSql.startsWith('select count(*) as count, max(updated_at) as max_updated_at from bookmarks')) {
    const userId = String(values[0])
    const rows = Array.from(db.bookmarks.values()).filter((r) => r.user_id === userId && !r.deleted_at)
    return { results: countFromRows(rows), success: true }
  }

  if (normalizedSql.startsWith('select count(*) as count, max(updated_at) as max_updated_at from bookmark_folders')) {
    const userId = String(values[0])
    const rows = Array.from(db.bookmarkFolders.values()).filter(
      (r) => r.user_id === userId && Number(r.is_deleted) === 0,
    )
    return { results: countFromRows(rows), success: true }
  }

  if (normalizedSql.startsWith('select count(*) as count, max(updated_at) as max_updated_at from tags')) {
    const userId = String(values[0])
    const rows = Array.from(db.tags.values()).filter((r) => r.user_id === userId && !r.deleted_at)
    return { results: countFromRows(rows), success: true }
  }

  if (normalizedSql.startsWith('select count(*) as count, max(updated_at) as max_updated_at from tab_groups')) {
    const userId = String(values[0])
    const rows = Array.from(db.tabGroups.values()).filter(
      (r) => r.user_id === userId && Number(r.is_deleted) === 0,
    )
    return { results: countFromRows(rows), success: true }
  }

  if (normalizedSql.includes('from tab_group_items tgi join tab_groups tg')) {
    const userId = String(values[0])
    const items = Array.from(db.tabGroupItems.values()).filter((item) => {
      const group = db.tabGroups.get(item.group_id)
      return Boolean(group) && group!.user_id === userId && Number(group!.is_deleted) === 0
    })
    let maxUpdatedAt: string | null = null
    for (const item of items) {
      const group = db.tabGroups.get(item.group_id)!
      const ts = group.updated_at ?? item.created_at
      if (maxUpdatedAt === null || ts > maxUpdatedAt) maxUpdatedAt = ts
    }
    return {
      results: [{ count: items.length, max_updated_at: maxUpdatedAt } as unknown as T],
      success: true,
    }
  }

  return null
}
