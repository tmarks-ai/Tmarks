import type { ExportScope, ExportStats } from '@tmarks/contracts'

interface CountRow {
  count: number
}

export async function getExportStats(
  db: D1Database,
  userId: string,
  scope: ExportScope,
  includeDeleted: boolean
): Promise<ExportStats> {
  const bookmarkWhere = includeDeleted ? 'user_id = ?' : 'user_id = ? AND deleted_at IS NULL'
  const folderWhere = includeDeleted ? 'user_id = ?' : 'user_id = ? AND is_deleted = 0'
  const tagWhere = includeDeleted ? 'user_id = ?' : 'user_id = ? AND deleted_at IS NULL'
  const tabGroupWhere = includeDeleted ? 'user_id = ?' : 'user_id = ? AND is_deleted = 0'

  const shouldBookmarks = scope === 'all' || scope === 'bookmarks'
  const shouldTabGroups = scope === 'all' || scope === 'tab_groups'

  const [bookmarkCount, folderCount, tagCount, pinnedCount, tabGroupCount] = await Promise.all([
    shouldBookmarks
      ? db.prepare(`SELECT COUNT(*) as count FROM bookmarks WHERE ${bookmarkWhere}`).bind(userId).first<CountRow>()
      : Promise.resolve({ count: 0 } as CountRow),
    shouldBookmarks
      ? db.prepare(`SELECT COUNT(*) as count FROM bookmark_folders WHERE ${folderWhere}`).bind(userId).first<CountRow>()
      : Promise.resolve({ count: 0 } as CountRow),
    shouldBookmarks
      ? db.prepare(`SELECT COUNT(*) as count FROM tags WHERE ${tagWhere}`).bind(userId).first<CountRow>()
      : Promise.resolve({ count: 0 } as CountRow),
    shouldBookmarks
      ? db.prepare(`SELECT COUNT(*) as count FROM bookmarks WHERE ${bookmarkWhere} AND is_pinned = 1`).bind(userId).first<CountRow>()
      : Promise.resolve({ count: 0 } as CountRow),
    shouldTabGroups
      ? db.prepare(`SELECT COUNT(*) as count FROM tab_groups WHERE ${tabGroupWhere}`).bind(userId).first<CountRow>()
      : Promise.resolve({ count: 0 } as CountRow),
  ])

  return {
    total_bookmarks: bookmarkCount?.count || 0,
    total_bookmark_folders: folderCount?.count || 0,
    total_tags: tagCount?.count || 0,
    pinned_bookmarks: pinnedCount?.count || 0,
    total_tab_groups: tabGroupCount?.count || 0,
  }
}

export function estimateExportSize(stats: ExportStats): number {
  // Heuristic. Export is JSON; real size depends on text lengths and tab-group items.
  const avgBookmarkSize = 350
  const avgFolderSize = 140
  const avgTagSize = 90
  const avgTabGroupSize = 700
  return (
    stats.total_bookmarks * avgBookmarkSize +
    stats.total_bookmark_folders * avgFolderSize +
    stats.total_tags * avgTagSize +
    stats.total_tab_groups * avgTabGroupSize
  )
}
