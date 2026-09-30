import type { BookmarkDTO, BookmarkFolderDTO, EntityId, PublicTagDTO, Revision, TabGroupDTO, TabGroupItemDTO, TagDTO } from '@tmarks/contracts'

/** 后端同步变更 payload 是原始 DB 行(snake_case + 数字布尔 + tags JSON 串)。
 *  这里镜像 web 的 normalizeTabGroup/normalizeTabGroupItem,转回干净 DTO。 */

function num(v: unknown): number {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v)
    return Number.isFinite(n) ? n : 0
  }
  return 0
}

function boolInt(v: unknown): boolean {
  return v === 1 || v === true
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : v == null ? '' : String(v)
}

/** 强制 http/https URL:非 http(s) 协议返回空串,防御服务器同步来的 javascript:/data: 等危险 URL。 */
function httpUrl(v: unknown): string {
  const s = str(v)
  if (!s) return ''
  try {
    const u = new URL(s)
    return u.protocol === 'http:' || u.protocol === 'https:' ? s : ''
  } catch {
    return ''
  }
}

function nullableStr(v: unknown): string | null {
  if (v == null) return null
  return typeof v === 'string' ? v || null : String(v)
}

function parseTags(v: unknown): string[] {
  if (Array.isArray(v)) return v.filter((x): x is string => typeof x === 'string')
  if (typeof v === 'string' && v.trim()) {
    try {
      const parsed = JSON.parse(v)
      return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : []
    } catch {
      return []
    }
  }
  return []
}

interface NormalizedTabGroup {
  dto: Omit<TabGroupDTO, 'item_count' | 'items'>
  isDeleted: boolean
}

/** 行 → TabGroupDTO(无 item_count/items,由合并阶段补)。 */
export function normalizeTabGroupRow(row: Record<string, unknown>): NormalizedTabGroup {
  return {
    dto: {
      id: str(row.id) as EntityId,
      title: str(row.title),
      color: nullableStr(row.color),
      tags: parseTags(row.tags),
      parent_id: nullableStr(row.parent_id) as EntityId | null,
      is_folder: boolInt(row.is_folder),
      position: num(row.position),
      created_at: str(row.created_at),
      updated_at: str(row.updated_at),
      deleted_at: nullableStr(row.deleted_at),
    },
    isDeleted: row.is_deleted === 1 || Boolean(row.deleted_at),
  }
}

interface NormalizedTabGroupItem {
  dto: TabGroupItemDTO
  isDeleted: boolean
}

/** 行 → TabGroupItemDTO。 */
export function normalizeTabGroupItemRow(row: Record<string, unknown>): NormalizedTabGroupItem {
  return {
    dto: {
      id: str(row.id) as EntityId,
      group_id: str(row.group_id) as EntityId,
      title: str(row.title),
      url: httpUrl(row.url),
      favicon: nullableStr(row.favicon),
      position: num(row.position),
      created_at: str(row.created_at),
      is_pinned: boolInt(row.is_pinned),
      is_todo: boolInt(row.is_todo),
      is_archived: boolInt(row.is_archived),
    },
    isDeleted: row.is_deleted === 1 || Boolean(row.deleted_at),
  }
}

/** 后端 bookmark change payload 的 tags 宽松解析(PublicTagDTO[]);无则空(badge 只依赖 url)。 */
function parsePublicTags(v: unknown): PublicTagDTO[] {
  if (!Array.isArray(v)) return []
  return v
    .filter((x): x is Record<string, unknown> => typeof x === 'object' && x !== null)
    .map((x) => ({ id: str(x.id) as EntityId, name: str(x.name), color: nullableStr(x.color) }))
}

interface NormalizedBookmark {
  dto: BookmarkDTO
  isDeleted: boolean
}

/** 行 → BookmarkDTO(pull 落库本地副本用;folder_path 不注入,tags 宽松解析)。 */
export function normalizeBookmarkRow(row: Record<string, unknown>): NormalizedBookmark {
  return {
    dto: {
      id: str(row.id) as EntityId,
      user_id: str(row.user_id) as EntityId,
      folder_id: nullableStr(row.folder_id) as EntityId | null,
      title: str(row.title),
      url: httpUrl(row.url),
      description: nullableStr(row.description),
      cover_image: nullableStr(row.cover_image),
      favicon: nullableStr(row.favicon),
      is_pinned: boolInt(row.is_pinned),
      pin_order: row.pin_order == null ? null : num(row.pin_order),
      is_archived: boolInt(row.is_archived),
      is_todo: boolInt(row.is_todo),
      is_private: boolInt(row.is_private),
      position: num(row.position),
      click_count: num(row.click_count),
      last_clicked_at: nullableStr(row.last_clicked_at),
      revision: nullableStr(row.revision) as Revision | null,
      folder_path: [],
      created_at: str(row.created_at),
      updated_at: str(row.updated_at),
      deleted_at: nullableStr(row.deleted_at),
      tags: parsePublicTags(row.tags),
    },
    isDeleted: row.is_deleted === 1 || Boolean(row.deleted_at),
  }
}

interface NormalizedFolder {
  dto: BookmarkFolderDTO
  isDeleted: boolean
}

/** 行 → BookmarkFolderDTO(sync 行扁平无 children;user_id/bookmark_count sync 缺失占位)。 */
export function normalizeFolderRow(row: Record<string, unknown>): NormalizedFolder {
  return {
    dto: {
      id: str(row.id) as EntityId,
      user_id: str(row.user_id) as EntityId,
      name: str(row.name),
      parent_id: nullableStr(row.parent_id) as EntityId | null,
      position: num(row.position),
      bookmark_count: num(row.bookmark_count),
      created_at: str(row.created_at),
      updated_at: str(row.updated_at),
      deleted_at: nullableStr(row.deleted_at),
    },
    isDeleted: row.is_deleted === 1 || Boolean(row.deleted_at),
  }
}

interface NormalizedTag {
  dto: TagDTO
  isDeleted: boolean
}

/** 行 → TagDTO(tags 无 is_deleted 列,据 deleted_at 推导;bookmark_count 由服务端
 * 维护计数(tags.bookmark_count)经 bootstrap/pull 携带,organizer 采样与弹窗排序依赖它)。 */
export function normalizeTagRow(row: Record<string, unknown>): NormalizedTag {
  return {
    dto: {
      id: str(row.id) as EntityId,
      name: str(row.name),
      color: nullableStr(row.color),
      click_count: num(row.click_count),
      bookmark_count: num(row.bookmark_count),
      created_at: str(row.created_at),
      updated_at: str(row.updated_at),
    },
    isDeleted: Boolean(row.deleted_at),
  }
}
