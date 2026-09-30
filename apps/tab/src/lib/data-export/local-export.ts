import { db } from '../db'
import { isLiveBookmark, isLiveFolder, isLiveTabGroup, isLiveTabGroupItem, isLiveTag } from '../db/live-filter'
import type { LocalBookmark, LocalFolder, LocalTag, LocalTabGroup, LocalTabGroupItem } from '../db'

/** 本地导出数据结构(scope=all 时含全部实体)。 */
export interface LocalExportData {
  version: 1
  exported_at: string
  bookmarks: LocalBookmark[]
  folders: LocalFolder[]
  tags: LocalTag[]
  tabGroups: LocalTabGroup[]
  tabGroupItems: LocalTabGroupItem[]
}

export type ExportScope = 'all' | 'bookmarks' | 'tab_groups'

export interface ExportOptions {
  scope: ExportScope
  includeDeleted?: boolean
}

/** 从本地 Dexie 收集数据 -> LocalExportData。 */
export async function collectLocalExport(options: ExportOptions): Promise<LocalExportData> {
  const includeDeleted = options.includeDeleted ?? false
  // RC-A:统一用 isLive 谓词(双标墓碑:deleted_at + pending_op='delete')判活,替代此前
  // 仅按 deleted_at 过滤的分裂实现(会漏掉 pending_op='delete' 但无 deleted_at 的墓碑行)。
  const filterBookmark = (rows: LocalBookmark[]): LocalBookmark[] => includeDeleted ? rows : rows.filter(isLiveBookmark)
  const filterFolder = (rows: LocalFolder[]): LocalFolder[] => includeDeleted ? rows : rows.filter(isLiveFolder)
  const filterGroup = (rows: LocalTabGroup[]): LocalTabGroup[] => includeDeleted ? rows : rows.filter(isLiveTabGroup)
  const filterItem = (rows: LocalTabGroupItem[]): LocalTabGroupItem[] => includeDeleted ? rows : rows.filter(isLiveTabGroupItem)
  const liveTags = (rows: LocalTag[]): LocalTag[] => includeDeleted ? rows : rows.filter(isLiveTag)

  const [bookmarks, folders, tags, tabGroups, tabGroupItems] = await Promise.all([
    db.bookmarks.toArray(),
    db.folders.toArray(),
    db.tags.toArray(),
    db.tabGroups.toArray(),
    db.tabGroupItems.toArray(),
  ])

  const data: LocalExportData = {
    version: 1,
    exported_at: new Date().toISOString(),
    bookmarks: [],
    folders: [],
    tags: [],
    tabGroups: [],
    tabGroupItems: [],
  }

  if (options.scope === 'all' || options.scope === 'bookmarks') {
    data.bookmarks = filterBookmark(bookmarks)
    data.folders = filterFolder(folders)
    data.tags = liveTags(tags)
  }
  if (options.scope === 'all' || options.scope === 'tab_groups') {
    data.tabGroups = filterGroup(tabGroups)
    data.tabGroupItems = filterItem(tabGroupItems)
    // tab_groups 单独导出时,标签组仅存 tag ID(TabGroupDTO.tags: string[]),
    // 需补全被引用的 tag 定义,否则干净环境恢复后 tag ID 悬空。
    // (all/bookmarks 已在上面含全量 live tags,不在此覆盖)
    if (options.scope === 'tab_groups') {
      const referencedTagIds = new Set(data.tabGroups.flatMap((g) => g.tags))
      if (referencedTagIds.size > 0) {
        data.tags = liveTags(tags).filter((tg) => referencedTagIds.has(tg.id))
      }
    }  }
  return data
}

/** 触发浏览器下载 JSON 文件(popup/options 上下文)。 */
export function downloadJsonFile(data: LocalExportData, filename: string): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** 统计摘要(导出面板显示实体计数)。只数活行:导出默认输出活行、
 * CacheStatusSection 也按 !deleted_at 过滤——含墓碑的原始 count 会让
 * 数据页卡片与导出文件/缓存卡三方数字互相矛盾。 */
export async function getLocalExportSummary(): Promise<{
  bookmarks: number
  folders: number
  tags: number
  tabGroups: number
  tabGroupItems: number
}> {
  const isLive = (row: { deleted_at?: string | null; pending_op?: string | null }) => !row.deleted_at && row.pending_op !== 'delete'
  const [bookmarks, folders, tags, tabGroups, tabGroupItems] = await Promise.all([
    db.bookmarks.filter(isLive).count(),
    db.folders.filter(isLive).count(),
    db.tags.filter(isLive).count(),
    db.tabGroups.filter(isLive).count(),
    db.tabGroupItems.filter(isLive).count(),
  ])
  return { bookmarks, folders, tags, tabGroups, tabGroupItems }
}
