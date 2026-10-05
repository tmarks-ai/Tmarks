import { normalizeUrlKey } from '@tmarks/ai'
import { db, type LocalBookmark } from './index'
import { mergeDirty, queueBookmarkUpsert, ensureBookmarkFolderPath, ensureTag, validateBookmarkUrl } from './bookmark-helpers'
import type { EntityId, PublicTagDTO } from '@tmarks/contracts'

interface SaveLocalBookmarkInput {
  title: string
  url: string
  description?: string | null
  cover_image?: string | null
  favicon?: string | null
  folder_id?: EntityId | null
  folder_path?: string[]
  tags?: string[]
  is_pinned?: boolean
  is_private?: boolean
  /** 批量调用方(导入执行器)预扫一次构建的归一化 URL → 活行索引,替代每存一次的全表扫描。 */
  existingIndex?: BookmarkLookupIndex
}

/**
 * R8 TA-3: saveBookmarkLocal 的查重此前每次 `toArray().find(...)` 全表反序列化
 * ——20k 书签的浏览器导入在执行层复活了 ~2e8 次归一化(types.ts 的解析层修复
 * 白做)。批量路径构建一次该索引,循环内 O(1) 命中;墓碑行不算"已存在"。
 */
export interface BookmarkLookupIndex {
  get(url: string): LocalBookmark | undefined
}

export function buildBookmarkLookupIndex(rows: LocalBookmark[]): BookmarkLookupIndex {
  const byKey = new Map<string, LocalBookmark>()
  for (const bookmark of rows) {
    if (bookmark.deleted_at || bookmark.pending_op === 'delete') continue
    byKey.set(normalizeUrlKey(bookmark.url), bookmark)
  }
  return { get: (url) => byKey.get(normalizeUrlKey(url)) }
}

/** 按 normalized url 去重:已存在则更新,否则新建。设 dirty_fields + 入队 + 审计。 */
export async function saveBookmarkLocal(input: SaveLocalBookmarkInput): Promise<LocalBookmark> {
  if (!validateBookmarkUrl(input.url)) throw new Error('Invalid bookmark URL')
  const now = new Date().toISOString()

  let folderId = input.folder_id ?? null
  if (!folderId && input.folder_path && input.folder_path.length > 0) {
    folderId = await ensureBookmarkFolderPath(input.folder_path)
  }

  const tagRows = input.tags && input.tags.length > 0 ? await Promise.all(input.tags.map((n) => ensureTag(n))) : []
  const tags: PublicTagDTO[] = tagRows.map((t) => ({ id: t.id, name: t.name, color: t.color }))

  // 有注入索引走 O(1) 命中(导入批量路径);否则保持单条调用的全表查重。
  const existing = input.existingIndex
    ? input.existingIndex.get(input.url)
    : (await db.bookmarks.toArray()).find((bookmark) => normalizeUrlKey(bookmark.url) === normalizeUrlKey(input.url))
  if (existing && existing.pending_op !== 'delete') {
    const changed = ['title', 'url', 'description', 'folder_id', 'tags', 'is_private', 'updated_at']
    const bm: LocalBookmark = {
      ...existing,
      title: input.title || existing.title,
      description: input.description ?? existing.description,
      folder_id: folderId,
      tags,
      is_pinned: input.is_pinned ?? existing.is_pinned,
      is_private: input.is_private ?? existing.is_private,
      updated_at: now,
      dirty_fields: mergeDirty(existing.dirty_fields, changed),
      pending_op: 'upsert',
    }
    await db.transaction('rw', [db.bookmarks, db.syncQueue, db.operationLogs, db.meta], async () => {
      await db.bookmarks.put(bm)
      await queueBookmarkUpsert(bm)
    })
    return bm
  }

  const id = crypto.randomUUID() as EntityId
  const bm: LocalBookmark = {
    id, user_id: '' as EntityId,
    title: input.title || input.url, url: input.url,
    description: input.description ?? null,
    cover_image: input.cover_image ?? null,
    favicon: input.favicon ?? null, folder_id: folderId,
    is_pinned: input.is_pinned ?? false, pin_order: null, is_archived: false,
    is_todo: false, is_private: input.is_private ?? false, position: 0,
    click_count: 0, last_clicked_at: null, revision: null, folder_path: [],
    created_at: now, updated_at: now, deleted_at: null, tags,
    base_revision: null, dirty_fields: ['title', 'url', 'description', 'folder_id', 'favicon', 'tags'], pending_op: 'upsert',
  }
  await db.transaction('rw', [db.bookmarks, db.syncQueue, db.operationLogs, db.meta], async () => {
    await db.bookmarks.put(bm)
    await queueBookmarkUpsert(bm)
  })
  return bm
}
