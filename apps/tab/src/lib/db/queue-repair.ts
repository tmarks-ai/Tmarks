import { db } from './index'
import { getDirtyEntities } from './sync-state'
import { enqueueSyncOperation, syncKey, type SyncEntityType } from './queue'
import type { Revision, SyncOperationType } from '@tmarks/contracts'
import type { LocalBookmark, LocalFolder, LocalTag, LocalTabGroup, LocalTabGroupItem } from './index'

/**
 * 把滞留在 'syncing' 的队列项复位为 'pending'。pushDirty 只在 SW 内运行且
 * 由 inFlight 互斥串行化,所以入口/收尾调用它都不会碰并行推送的行:
 * - 入口:上一次 pushDirty 异常崩溃残留的行(此前只能等 SW 冷启动复位);
 * - 收尾:quota 减半回退时,被宽批次标成 'syncing' 又落在重试切片之外、
 *   break 后无人接手的行——takePendingBatch 不拾取 'syncing',不复位
 *   就永久滞留。重推由服务端幂等键兜底,安全。
 */
export async function resetStrandedSyncingRows(): Promise<void> {
  const ts = new Date().toISOString()
  await db.syncQueue.where('status').equals('syncing').modify({ status: 'pending', updated_at: ts })
}

/**
 * 队列自修复:为 `dirty_fields` 非空但没有对应 pending/failed 队列项的实体补建队列。
 * 覆盖 6 类实体(bookmark/folder/tag/tab_group/tab_group_item;新模型 preference 暂不落库)。
 * 修复崩溃/迁移残留的"脏实体无队列项"不一致。
 */
export async function repairPendingSyncQueue(): Promise<number> {
  const queued = await loadQueuedKeys()
  // 一次加载全部 5 类脏实体并复用,避免每个 repair* 各调一次 getDirtyEntities(否则每次
  // 同步会做 5× 全表 toArray,中等数据量即明显拖慢)。
  const dirty = await getDirtyEntities()
  const counts = await Promise.all([
    repairBookmarks(queued, dirty.bookmarks),
    repairFolders(queued, dirty.folders),
    repairTags(queued, dirty.tags),
    repairTabGroups(queued, dirty.tabGroups),
    repairTabGroupItems(queued, dirty.tabGroupItems),
  ])
  return counts.reduce((sum, n) => sum + n, 0)
}

async function loadQueuedKeys(): Promise<Set<string>> {
  // RC-K:排除 'conflict' 行,使其不占去重键。这样 dirty 实体若仅有 conflict 队列项时,
  // repair 不再 continue 跳过,而是调 enqueueSyncOperation 把该 conflict 行翻转为 pending
  // (重新上报冲突后的本地编辑),避免冲突后编辑被永久搁置。
  // 'exhausted' 加入键集:终态死信不得被修复翻回 pending(否则每次同步
  // 空转:推上去 → 幂等重放存储的拒绝 → 再 exhausted)。'conflict' 仍排除,
  // 保持 RC-K 的"冲突后再编辑即翻转"语义;用户再次编辑会经
  // enqueueSyncOperation 的 status!=='synced' 匹配覆盖 exhausted 行复活。
  const items = await db.syncQueue
    .where('status')
    .anyOf(['pending', 'syncing', 'failed', 'exhausted'])
    .toArray()
  return new Set(items.map((r) => syncKey(r.entity_type as SyncEntityType, r.entity_id, r.operation)))
}

async function repairBookmarks(queued: Set<string>, bookmarks: LocalBookmark[]): Promise<number> {
  let repaired = 0
  for (const b of bookmarks) {
    const operation: SyncOperationType = b.pending_op ?? 'upsert'
    if (queued.has(syncKey('bookmark', b.id, operation))) continue
    const payload = operation === 'delete' ? { folder_id: b.folder_id } : bookmarkPayload(b)
    await enqueueSyncOperation({ entityType: 'bookmark', entityId: b.id, operation, baseRevision: b.base_revision, payload })
    queued.add(syncKey('bookmark', b.id, operation))
    repaired++
  }
  return repaired
}

function bookmarkPayload(b: LocalBookmark): Record<string, unknown> {
  // Must mirror toBookmarkSyncPayload field-for-field: the server applier
  // fills missing fields with defaults (position=0, is_todo/is_archived=0),
  // so a lossy repair payload silently RESETS manual order and todo/archive
  // flags server-side and the reset then propagates to every device.
  return {
    title: b.title,
    url: b.url,
    description: b.description,
    folder_id: b.folder_id,
    favicon: b.favicon,
    cover_image: b.cover_image,
    is_pinned: b.is_pinned,
    pin_order: b.pin_order,
    is_todo: b.is_todo,
    is_archived: b.is_archived,
    is_private: b.is_private,
    position: b.position,
    tag_ids: b.tags.map((t) => t.id),
    tag_names: b.tags.map((t) => t.name),
  }
}

async function repairFolders(queued: Set<string>, folders: LocalFolder[]): Promise<number> {
  let repaired = 0
  for (const f of folders) {
    const operation: SyncOperationType = f.pending_op ?? 'upsert'
    if (queued.has(syncKey('bookmark_folder', f.id, operation))) continue
    const payload = operation === 'delete' ? { parent_id: f.parent_id } : { name: f.name, parent_id: f.parent_id, position: f.position }
    await enqueueSyncOperation({ entityType: 'bookmark_folder', entityId: f.id, operation, baseRevision: f.base_revision, payload })
    queued.add(syncKey('bookmark_folder', f.id, operation))
    repaired++
  }
  return repaired
}

async function repairTags(queued: Set<string>, tags: LocalTag[]): Promise<number> {
  let repaired = 0
  for (const tg of tags) {
    const operation: SyncOperationType = tg.pending_op ?? 'upsert'
    if (queued.has(syncKey('tag', tg.id, operation))) continue
    const payload = operation === 'delete' ? {} : { name: tg.name, color: tg.color }
    await enqueueSyncOperation({ entityType: 'tag', entityId: tg.id, operation, baseRevision: tg.base_revision, payload })
    queued.add(syncKey('tag', tg.id, operation))
    repaired++
  }
  return repaired
}

async function repairTabGroups(queued: Set<string>, tabGroups: LocalTabGroup[]): Promise<number> {
  let repaired = 0
  for (const g of tabGroups) {
    const operation: SyncOperationType = g.pending_op ?? 'upsert'
    if (queued.has(syncKey('tab_group', g.id, operation))) continue
    const payload = operation === 'delete' ? { parent_id: g.parent_id } : tabGroupPayload(g)
    await enqueueSyncOperation({ entityType: 'tab_group', entityId: g.id, operation, baseRevision: g.base_revision, payload })
    queued.add(syncKey('tab_group', g.id, operation))
    repaired++
  }
  return repaired
}

function tabGroupPayload(g: LocalTabGroup): Record<string, unknown> {
  return {
    title: g.title,
    parent_id: g.parent_id,
    is_folder: g.is_folder,
    position: g.position,
    color: g.color,
    tags: g.tags,
  }
}

async function repairTabGroupItems(queued: Set<string>, tabGroupItems: LocalTabGroupItem[]): Promise<number> {
  let repaired = 0
  for (const it of tabGroupItems) {
    const operation: SyncOperationType = it.pending_op ?? 'upsert'
    if (queued.has(syncKey('tab_group_item', it.id, operation))) continue
    const payload = operation === 'delete' ? { group_id: it.group_id } : tabGroupItemPayload(it)
    await enqueueSyncOperation({ entityType: 'tab_group_item', entityId: it.id, operation, baseRevision: it.base_revision as Revision | null, payload })
    queued.add(syncKey('tab_group_item', it.id, operation))
    repaired++
  }
  return repaired
}

function tabGroupItemPayload(it: LocalTabGroupItem): Record<string, unknown> {
  return {
    group_id: it.group_id,
    title: it.title,
    url: it.url,
    favicon: it.favicon,
    position: it.position,
    is_pinned: it.is_pinned,
    is_todo: it.is_todo,
    is_archived: it.is_archived,
  }
}
