import type { EntityId, PublicTagDTO } from '@tmarks/contracts'
import { normalizeUrlKey } from '@tmarks/ai/url'
import { db, type LocalBookmark, type LocalTag } from '../lib/db'
import { ensureBookmarkFolderPath, ensureTag, toBookmarkSyncPayload } from '../lib/db/bookmark-helpers'
import { enqueueSyncOperation } from '../lib/db/queue'
import { logOperation } from '../lib/db/operation-logs'
import { mergeDirty } from './save-helpers'

export interface PersistBookmarkInput {
  existing: LocalBookmark | null
  url: string
  title: string
  nextDescription: string | null
  nextCover: string | null
  favicon: string | null
  userPickedFolder: boolean
  folderId: string | null
  aiFolderPath: string[]
  isPrivate: boolean
  isTodo: boolean
  uniqueSelectedNames: string[]
  knownByName: Map<string, { id: string; name: string; color: string | null }>
}

/**
 * 弹窗保存的落库事务(自 useBookmarkSave 拆出,便于直接测试)。
 * 全有或全无:新标签/新目录创建 + 书签落库 + 同步入队 + 审计日志同一事务
 * (此前 ensureTag/ensureBookmarkFolderPath 在事务外,保存失败会留下孤儿
 * 标签/目录并被 repairPendingSyncQueue 照样推送)。事务表集含 tags/folders。
 * base 在事务内解析:existing 是弹窗加载时的快照,同会话两次保存之间后台
 * pull 可能改过该行——按 id 重读最新行再叠加表单字段,避免写回陈旧的
 * is_pinned/position/pin_order;快照为空时按 normalizeUrlKey 复查同 URL 行
 * (另一设备保存同一页面),命中即并入该行更新,否则才新建——否则同页双行,
 * 推送时撞服务端 normalized_url 部分唯一索引。
 */
export async function persistBookmarkSave(input: PersistBookmarkInput): Promise<LocalBookmark> {
  const now = new Date().toISOString()
  const changedFields = ['title', 'description', 'cover_image', 'folder_id', 'tags', 'is_private', 'is_todo', 'updated_at']
  return db.transaction('rw', [db.bookmarks, db.tags, db.folders, db.syncQueue, db.operationLogs, db.meta], async (): Promise<LocalBookmark> => {
    const aiTags: LocalTag[] = []
    // "单次最多 1 个新标签"是提示词对模型的治理规则(执法在 prompt 归一化层);
    // 保存路径的用户已确认标签(手输+点选)不受该上限——超出被静默丢弃而
    // 选中面板仍显示,用户以为已保存。
    for (const name of input.uniqueSelectedNames) {
      if (!input.knownByName.has(name.toLowerCase())) aiTags.push(await ensureTag(name))
    }
    const selectedKnown = input.uniqueSelectedNames.map((name) => input.knownByName.get(name.toLowerCase())).filter((tag): tag is NonNullable<typeof tag> => Boolean(tag))
    const tagsById = new Map<string, PublicTagDTO>()
    for (const tag of [...selectedKnown.map((t2) => ({ id: t2.id, name: t2.name, color: t2.color })), ...aiTags.map((t2) => ({ id: t2.id, name: t2.name, color: t2.color }))]) tagsById.set(tag.id, { id: tag.id, name: tag.name, color: tag.color })
    const newTags = [...tagsById.values()]
    const finalFolderId = input.userPickedFolder ? input.folderId : (input.aiFolderPath.length > 0 ? await ensureBookmarkFolderPath(input.aiFolderPath) : input.folderId)
    let base = input.existing ? ((await db.bookmarks.get(input.existing.id)) ?? input.existing) : null
    if (!base) {
      const key = normalizeUrlKey(input.url)
      base = (await db.bookmarks.toArray()).find((row) => !row.deleted_at && normalizeUrlKey(row.url) === key) ?? null
    }
    const record: LocalBookmark = base
      ? { ...base, title: input.title || base.title, description: input.nextDescription, cover_image: input.nextCover, folder_id: finalFolderId, tags: newTags, is_private: input.isPrivate, is_todo: input.isTodo, updated_at: now, dirty_fields: mergeDirty(base.dirty_fields, changedFields), pending_op: 'upsert' }
      : { id: crypto.randomUUID() as EntityId, user_id: '' as EntityId, title: input.title || input.url, url: input.url, description: input.nextDescription, cover_image: input.nextCover, favicon: input.favicon, folder_id: finalFolderId, is_pinned: false, pin_order: null, is_archived: false, is_todo: input.isTodo, is_private: input.isPrivate, position: 0, click_count: 0, last_clicked_at: null, revision: null, folder_path: [], created_at: now, updated_at: now, deleted_at: null, tags: newTags, base_revision: null, dirty_fields: ['title', 'url', 'description', 'cover_image', 'favicon', 'folder_id', 'tags', 'is_private', 'is_todo'], pending_op: 'upsert' }
    await db.bookmarks.put(record)
    await enqueueSyncOperation({ entityType: 'bookmark', entityId: record.id, operation: 'upsert', baseRevision: record.base_revision, payload: toBookmarkSyncPayload(record) })
    await logOperation({ entity_type: 'bookmark', entity_id: record.id, operation: 'upsert' })
    return record
  })
}
