import { db } from '../db'
import { enqueueSyncOperation } from '../db/queue'
import { logOperation } from '../db/operation-logs'
import { queueBookmarkUpsert } from '../db/bookmark-helpers'
import { ITEM_DIRTY_FIELDS, groupPayload, itemPayload } from '../db/tab-collections'
import type { LocalExportData } from './local-export'
import type { LocalBookmark, LocalFolder, LocalTag, LocalTabGroup, LocalTabGroupItem } from '../db'

export interface RestoreResult {
  bookmarks: number
  folders: number
  tags: number
  tabGroups: number
  tabGroupItems: number
  skipped: number
}

/** 恢复时各实体全量 dirty_fields(RC-H,修此前不全面导致部分字段不重新上报)。 */
const RESTORE_BOOKMARK_DIRTY = ['title', 'url', 'description', 'cover_image', 'favicon', 'folder_id', 'is_pinned', 'is_archived', 'is_todo', 'is_private', 'position', 'tags']
const RESTORE_FOLDER_DIRTY = ['name', 'parent_id', 'position']
const RESTORE_TAG_DIRTY = ['name', 'color']
const RESTORE_GROUP_DIRTY = ['title', 'color', 'tags', 'parent_id', 'position', 'item_count']

/** 备份文件可被篡改:恢复时仅接受绝对 http(s) URL,拒绝 javascript:/data: 等进入本地库。 */
function isRestorableUrl(value: string): boolean {
  try {
    const parsed = new URL(value)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}

/**
 * 本地优先判定(RC-H,用户确认"跳过已更新行"):本地行存在且有未上报改动(dirty_fields 非空)视为更新,
 * 或本地 updated_at ≥ 导出行 updated_at 视为更新 → 跳过,不覆盖。条目无 updated_at,仅凭 dirty_fields 判。
 */
function isLocalNewer(local: { updated_at?: string | null; dirty_fields: string[] }, exportRow: { updated_at?: string | null }): boolean {
  if (local.dirty_fields.length > 0) return true
  const lu = local.updated_at
  const eu = exportRow.updated_at
  if (lu && eu) return lu >= eu
  return false
}

/**
 * 从 LocalExportData 恢复(RC-H):
 * - 本地优先:本地已更新行跳过(不覆盖本地较新版本);
 * - 全量 dirty_fields + 事务内入队(修此前 enqueue 在事务外且 .catch 吞错,base_revision 无条件回退);
 * - 墓碑行(deleted_at 非空)恢复为删除态并上报 delete。
 */
export async function restoreLocalExport(data: LocalExportData): Promise<RestoreResult> {
  const result: RestoreResult = { bookmarks: 0, folders: 0, tags: 0, tabGroups: 0, tabGroupItems: 0, skipped: 0 }

  await db.transaction('rw', [db.bookmarks, db.folders, db.tags, db.tabGroups, db.tabGroupItems, db.syncQueue, db.operationLogs, db.meta], async () => {
    for (const b of data.bookmarks ?? []) {
      const local = await db.bookmarks.get(b.id)
      if (local && isLocalNewer(local, b)) { result.skipped++; continue }
      if (b.deleted_at) {
        await db.bookmarks.put({ ...b, dirty_fields: ['deleted_at'], pending_op: 'delete' })
        await enqueueSyncOperation({ entityType: 'bookmark', entityId: b.id, operation: 'delete', baseRevision: null, payload: { folder_id: b.folder_id } })
      } else {
        if (!isRestorableUrl(b.url)) { result.skipped++; continue }
        const row: LocalBookmark = { ...b, dirty_fields: RESTORE_BOOKMARK_DIRTY, pending_op: 'upsert' }
        await db.bookmarks.put(row)
        await queueBookmarkUpsert(row)
      }
      result.bookmarks++
    }
    for (const f of data.folders ?? []) {
      const local = await db.folders.get(f.id)
      if (local && isLocalNewer(local, f)) { result.skipped++; continue }
      if (f.deleted_at) {
        await db.folders.put({ ...f, dirty_fields: ['deleted_at'], pending_op: 'delete' })
        await enqueueSyncOperation({ entityType: 'bookmark_folder', entityId: f.id, operation: 'delete', baseRevision: null, payload: { parent_id: f.parent_id } })
      } else {
        const row: LocalFolder = { ...f, dirty_fields: RESTORE_FOLDER_DIRTY, pending_op: 'upsert' }
        await db.folders.put(row)
        await enqueueSyncOperation({ entityType: 'bookmark_folder', entityId: f.id, operation: 'upsert', baseRevision: f.base_revision, payload: { name: f.name, parent_id: f.parent_id, position: f.position } })
      }
      result.folders++
    }
    for (const tg of data.tags ?? []) {
      const local = await db.tags.get(tg.id)
      // tags 无 deleted_at;墓碑由 pending_op='delete' 表示。本地有未上报改动则跳过。
      if (local && local.dirty_fields.length > 0) { result.skipped++; continue }
      if (tg.pending_op === 'delete') {
        await db.tags.put({ ...tg, dirty_fields: ['deleted_at'], pending_op: 'delete' })
        await enqueueSyncOperation({ entityType: 'tag', entityId: tg.id, operation: 'delete', baseRevision: null, payload: {} })
      } else {
        const row: LocalTag = { ...tg, dirty_fields: RESTORE_TAG_DIRTY, pending_op: 'upsert' }
        await db.tags.put(row)
        await enqueueSyncOperation({ entityType: 'tag', entityId: tg.id, operation: 'upsert', baseRevision: tg.base_revision, payload: { name: tg.name, color: tg.color } })
      }
      result.tags++
    }
    for (const g of data.tabGroups ?? []) {
      const local = await db.tabGroups.get(g.id)
      if (local && isLocalNewer(local, g)) { result.skipped++; continue }
      if (g.deleted_at) {
        await db.tabGroups.put({ ...g, dirty_fields: ['deleted_at'], pending_op: 'delete' })
        await enqueueSyncOperation({ entityType: 'tab_group', entityId: g.id, operation: 'delete', baseRevision: null, payload: { parent_id: g.parent_id } })
      } else {
        const row: LocalTabGroup = { ...g, dirty_fields: RESTORE_GROUP_DIRTY, pending_op: 'upsert' }
        await db.tabGroups.put(row)
        await enqueueSyncOperation({ entityType: 'tab_group', entityId: g.id, operation: 'upsert', baseRevision: g.base_revision, payload: groupPayload(row) })
      }
      result.tabGroups++
    }
    for (const it of data.tabGroupItems ?? []) {
      const local = await db.tabGroupItems.get(it.id)
      if (local && local.dirty_fields.length > 0) { result.skipped++; continue }
      // 条目无 deleted_at 列,墓碑由 pending_op='delete' 表示(RC-A:与组双标墓碑不同)。
      if (it.pending_op === 'delete') {
        await db.tabGroupItems.put({ ...it, dirty_fields: [], pending_op: 'delete' })
        await enqueueSyncOperation({ entityType: 'tab_group_item', entityId: it.id, operation: 'delete', baseRevision: null, payload: { group_id: it.group_id } })
      } else {
        if (!isRestorableUrl(it.url)) { result.skipped++; continue }
        const row: LocalTabGroupItem = { ...it, dirty_fields: ITEM_DIRTY_FIELDS, pending_op: 'upsert' }
        await db.tabGroupItems.put(row)
        await enqueueSyncOperation({ entityType: 'tab_group_item', entityId: it.id, operation: 'upsert', baseRevision: it.base_revision, payload: itemPayload(row) })
      }
      result.tabGroupItems++
    }
  })

  if (result.bookmarks) await logOperation({ entity_type: 'bookmark', entity_id: 'bulk', operation: 'upsert', detail: `restored ${result.bookmarks} bookmarks` })
  return result
}

/** 读取并解析上传的 JSON 文件 -> LocalExportData(校验版本)。 */
export function parseExportFile(text: string): LocalExportData | null {
  try {
    const parsed = JSON.parse(text) as Partial<LocalExportData>
    if (parsed.version !== 1) return null
    return {
      version: 1,
      exported_at: parsed.exported_at ?? new Date().toISOString(),
      // 逐字段 Array.isArray:畸形文件(如 bookmarks 是对象)缺省会原样
      // 通过,后续遍历以不可预期的形状崩溃;这里统一落回空数组。
      bookmarks: asArray(parsed.bookmarks),
      folders: asArray(parsed.folders),
      tags: asArray(parsed.tags),
      tabGroups: asArray(parsed.tabGroups),
      tabGroupItems: asArray(parsed.tabGroupItems),
    }
  } catch {
    return null
  }
}

function asArray<T>(value: T[] | undefined): T[] {
  return Array.isArray(value) ? value : []
}
