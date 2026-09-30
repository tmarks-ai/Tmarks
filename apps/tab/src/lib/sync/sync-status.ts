/**
 * 本地同步状态聚合:为 background 的 GET_SYNC_STATUS handler 与单元测试提供统一数据形状。
 * 数据来源:
 *   - 实体 count → lib/db 的 bookmarks/folders/tags/tabGroups/tabGroupItems 表
 *   - pendingOps → syncQueue 中 status === 'pending' 的记录数
 *   - syncMode / lastSyncAt → syncState (singleton)
 */
import type { ISODateTimeString } from '@tmarks/contracts'
import type { TMarkDB } from '../db'

interface LocalSyncStatusCounts {
  bookmarks: number
  folders: number
  tags: number
  tabGroups: number
  tabGroupItems: number
}

interface LocalSyncStatus {
  syncMode: 'local_only' | 'cloud_sync' | 'paused'
  pendingOps: number
  lastSyncAt: ISODateTimeString | null
  counts: LocalSyncStatusCounts
}

/** 聚合本地同步状态。接受 dbLike 便于单元测试传入独立实例。 */
async function getLocalSyncStatus(dbLike: Pick<TMarkDB,
  'bookmarks' | 'folders' | 'tags' | 'tabGroups' | 'tabGroupItems' | 'syncQueue' | 'syncState'
>): Promise<LocalSyncStatus> {
  const [syncState, bookmarks, folders, tags, tabGroups, tabGroupItems, pendingOps] = await Promise.all([
    dbLike.syncState.get('singleton'),
    dbLike.bookmarks.count(),
    dbLike.folders.count(),
    dbLike.tags.count(),
    dbLike.tabGroups.count(),
    dbLike.tabGroupItems.count(),
    // RC-L:统计 pending+failed+conflict(此前只数 pending,隐藏 failed/conflict,UI 误示"已同步")。
    dbLike.syncQueue.where('status').anyOf(['pending', 'failed', 'conflict', 'exhausted']).count(),
  ])

  return {
    syncMode: syncState?.mode ?? 'local_only',
    pendingOps,
    lastSyncAt: syncState?.last_sync_at ?? null,
    counts: { bookmarks, folders, tags, tabGroups, tabGroupItems },
  }
}

/**
 * Background `GET_SYNC_STATUS` handler 的可注入实现。
 * 单独导出便于单元测试在不加载 service worker 全局的前提下覆盖 sender 校验。
 */
export async function handleGetSyncStatus(
  dbLike: Parameters<typeof getLocalSyncStatus>[0],
): Promise<{ ok: true; data: LocalSyncStatus }> {
  const data = await getLocalSyncStatus(dbLike)
  return { ok: true, data }
}
