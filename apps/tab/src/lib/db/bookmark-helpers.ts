import { db } from './index'
import { enqueueSyncOperation } from './queue'
import { logOperation } from './operation-logs'
import type { EntityId } from '@tmarks/contracts'
import type { LocalBookmark, LocalFolder, LocalTag } from './index'

/** 合并 dirty_fields(去重)。 */
export function mergeDirty(existing: string[], changed: string[]): string[] {
  return [...new Set([...existing, ...changed])]
}

/** 入队书签 upsert + 写审计。 */
export async function queueBookmarkUpsert(bm: LocalBookmark): Promise<void> {
  await enqueueSyncOperation({
    entityType: 'bookmark',
    entityId: bm.id,
    operation: 'upsert',
    baseRevision: bm.base_revision,
    payload: toBookmarkSyncPayload(bm),
  })
  await logOperation({ entity_type: 'bookmark', entity_id: bm.id, operation: 'upsert' })
}

/** 书签 push payload(对齐 sync queue 快照)。 */
export function toBookmarkSyncPayload(bm: LocalBookmark): Record<string, unknown> {
  return {
    title: bm.title,
    url: bm.url,
    description: bm.description,
    folder_id: bm.folder_id,
    favicon: bm.favicon,
    cover_image: bm.cover_image,
    is_pinned: bm.is_pinned,
    pin_order: bm.pin_order,
    is_todo: bm.is_todo,
    is_archived: bm.is_archived,
    is_private: bm.is_private,
    position: bm.position,
    tag_ids: bm.tags.map((t) => t.id),
    tag_names: bm.tags.map((t) => t.name),
  }
}

/** 服务端标签名 50 上限的同口径镜像(tags.ts TAG_NAME_MAX_LENGTH):本地若以
 * 全长落库,推送后服务端按 50 截断存储,本地与服务端名称分歧,直到下次 pull
 * 才被服务端数据纠正。 */
const TAG_NAME_MAX_LENGTH = 50
/** 服务端同步面目录名 120 上限的同口径镜像(sync-folders clampText(name, 120))。 */
const FOLDER_NAME_MAX_LENGTH = 120

/** 确保文件夹路径存在(最多 2 级),返回末级 folder_id;缺失则本地新建并入队。 */
export async function ensureBookmarkFolderPath(pathParts: string[]): Promise<EntityId | null> {
  if (pathParts.length === 0) return null
  const trimmed = pathParts.map((p) => p.trim().slice(0, FOLDER_NAME_MAX_LENGTH).trim()).filter(Boolean).slice(0, 2)
  if (trimmed.length === 0) return null

  let parentId: EntityId | null = null
  let folderId: EntityId | null = null
  for (const name of trimmed) {
    // 同名文件夹可能存在于不同父级下(如 "工具" 既在 "开发" 也在 "设计" 下),
    // 需在所有同名候选里按 parent_id 精确匹配,否则 .first() 会漏掉正确项而创建重复。
    // 大小写不敏感兜底:AI 输出的目录名大小写不稳定(Tools/tools),精确匹配
    // 会落成重复目录;folders 表很小,兜底全表比较可忽略。
    const matchesParent = (f: LocalFolder) =>
      !f.deleted_at && f.pending_op !== 'delete' &&
      (parentId === null ? f.parent_id === null : f.parent_id === parentId)
    const byName = await db.folders.where('name').equals(name).toArray()
    const exact = byName.find(matchesParent)
    const lowered = name.toLowerCase()
    const existing = exact
      ?? (await db.folders.toArray()).find((f) => matchesParent(f) && f.name.toLowerCase() === lowered)
    if (existing) {
      folderId = existing.id
      parentId = existing.id
      continue
    }
    const now = new Date().toISOString()
    const id = crypto.randomUUID() as EntityId
    const folder: LocalFolder = {
      id, user_id: '' as EntityId, name, parent_id: parentId,
      position: 0, bookmark_count: 0, children: undefined,
      created_at: now, updated_at: now, deleted_at: null,
      base_revision: null, dirty_fields: ['name', 'parent_id', 'position'], pending_op: 'upsert',
    }
    await db.folders.put(folder)
    await enqueueSyncOperation({ entityType: 'bookmark_folder', entityId: id, operation: 'upsert', baseRevision: null, payload: { name, parent_id: parentId, position: 0 } })
    await logOperation({ entity_type: 'bookmark_folder', entity_id: id, operation: 'upsert' })
    folderId = id
    parentId = id
  }
  return folderId
}

/**
 * 确保标签存在(按 name 查重),返回 LocalTag;缺失则新建并入队。
 *
 * 查重大小写不敏感:AI 输出的标签大小写不稳定(linux / Linux / LINUX 是一个
 * 概念),精确匹配会把它们落成三个标签。常见路径(精确命中)走 name 索引,
 * 未命中才全表做一次小写比较兜底 —— 标签行很小,这次兜底可忽略。
 */
export async function ensureTag(rawName: string): Promise<LocalTag> {
  // 截断在查重之前:51+ 字符名与它的 50 前缀在服务端是同一个标签,本地若
  // 各存一行会推送出两行近重复。
  const name = rawName.trim().slice(0, TAG_NAME_MAX_LENGTH)
  if (!name) throw new Error('Tag name is empty.')
  const exact = await db.tags.where('name').equals(name).first()
  if (exact && exact.pending_op !== 'delete') return exact

  // Dexie can execute this as a case-insensitive index lookup; avoid loading
  // the entire tag table just to find a differently-cased existing name.
  const variant = await db.tags.where('name').equalsIgnoreCase(name).filter((tag) => tag.pending_op !== 'delete').first()
  if (variant) return variant

  const now = new Date().toISOString()
  const id = crypto.randomUUID() as EntityId
  const tag: LocalTag = {
    id, name, color: null, click_count: 0, bookmark_count: 0,
    created_at: now, updated_at: now,
    base_revision: null, dirty_fields: ['name', 'color'], pending_op: 'upsert',
  }
  await db.tags.put(tag)
  await enqueueSyncOperation({ entityType: 'tag', entityId: id, operation: 'upsert', baseRevision: null, payload: { name, color: null } })
  await logOperation({ entity_type: 'tag', entity_id: id, operation: 'upsert' })
  return tag
}

/** 校验 URL(http/https)。 */
export function validateBookmarkUrl(url: string): boolean {
  try {
    const p = new URL(url)
    return p.protocol === 'http:' || p.protocol === 'https:'
  } catch {
    return false
  }
}
