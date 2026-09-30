import type { EntityId, ISODateTimeString, Revision } from './primitives'
import type { PublicTagDTO } from './tags'

/**
 * 书签 DTO。对齐 backend wire:`normalizeBookmark(BookmarkRow)` 后 spread
 * `...row` 保留 `SELECT *` 全部列,并注入 `folder_path` 与 `tags`。
 *
 * 注:`pin_order`、`revision` 来自 DB 列,REST 当前不写,
 * 运行时为 `null`;`folder_path` 仅由 list/get/create/update 注入,trash
 * 不注入(见 `TrashBookmark`)。
 */
export interface BookmarkDTO {
  id: EntityId
  user_id: EntityId
  folder_id: EntityId | null
  title: string
  url: string
  description: string | null
  cover_image: string | null
  favicon: string | null
  is_pinned: boolean
  pin_order: number | null
  is_archived: boolean
  is_todo: boolean
  is_private: boolean
  position: number
  click_count: number
  last_clicked_at: ISODateTimeString | null
  revision: Revision | null
  folder_path: string[]
  created_at: ISODateTimeString
  updated_at: ISODateTimeString
  deleted_at: ISODateTimeString | null
  tags: PublicTagDTO[]
}

/** 回收站书签:`getTrashBookmarks`/`restoreBookmark` 不注入 folder_path。 */
export type TrashBookmark = Omit<BookmarkDTO, 'folder_path'>

export type BookmarkSort = 'created' | 'updated' | 'popular' | 'manual'

/**
 * 书签状态筛选(GET /bookmarks 的 `status` 参数取值)。
 * `private` 已预留后端支持,UI 暂未暴露。
 */
export type BookmarkStatusFilter = 'all' | 'todo' | 'pinned' | 'archived' | 'private'

export interface BookmarkQueryParams {
  keyword?: string
  tags?: string
  page_size?: number
  page_cursor?: string
  sort?: BookmarkSort
  /** @deprecated 兼容旧参数,新代码请用 `status: 'pinned'`。 */
  pinned?: boolean
  folder_id?: string
  status?: BookmarkStatusFilter
}

export interface CreateBookmarkInput {
  title: string
  url: string
  description?: string | null
  cover_image?: string | null
  favicon?: string | null
  folder_id?: EntityId | null
  folder_path?: string[]
  tags?: string[]
  tag_ids?: EntityId[]
  is_pinned?: boolean
  is_todo?: boolean
  is_private?: boolean
}

export interface UpdateBookmarkInput {
  title?: string
  url?: string
  description?: string | null
  cover_image?: string | null
  favicon?: string | null
  folder_id?: EntityId | null
  folder_path?: string[]
  tags?: string[]
  tag_ids?: EntityId[]
  is_pinned?: boolean
  is_todo?: boolean
  is_archived?: boolean
  is_private?: boolean
  position?: number
}

type BatchActionType = 'delete' | 'update_tags' | 'pin' | 'unpin' | 'todo' | 'untodo' | 'archive' | 'unarchive' | 'move'

/** Batch actions are validated and executed by the backend in one D1 operation. */
export interface BatchActionRequest {
  action: BatchActionType
  bookmark_ids: EntityId[]
  add_tag_ids?: EntityId[]
  remove_tag_ids?: EntityId[]
  is_pinned?: boolean
  folder_id?: EntityId | null
}

export interface BatchActionResponse {
  success: boolean
  affected_count: number
  errors?: Array<{ bookmark_id: EntityId; message: string }>
}

/** 重排序单条输入(POST /bookmarks/reorder,镜像 tab-groups batch-update)。folder_id 可选,跨文件夹移动+重排一步到位。 */
export interface ReorderBookmarkItem {
  id: EntityId
  position: number
  folder_id?: EntityId | null
}

/** 重排序书签输入(POST /bookmarks/reorder)。 */
export interface ReorderBookmarksInput {
  updates: ReorderBookmarkItem[]
}

/** 重排序书签结果(message + 实际更新条数)。 */
export interface ReorderBookmarksResult {
  message: string
  count: number
}

/** 置顶重排序输入(POST /bookmarks/reorder-pinned)。bookmark_ids 顺序即新 pin_order(0-based)。 */
export interface ReorderPinnedInput {
  bookmark_ids: EntityId[]
}

/** 置顶重排序结果。 */
export interface ReorderPinnedResult {
  message: string
  count: number
}

/**
 * 服务端抓取页面得到的表单元数据(GET /bookmarks/url-metadata)。
 * 抓取在 Worker 上进行(不经第三方 favicon 服务,域名不外泄);
 * favicon 恒有回退候选(目标站 /favicon.ico)。
 */
export interface UrlMetadataDTO {
  title: string | null
  description: string | null
  favicon: string | null
  cover_image: string | null
}

export interface UrlMetadataResponse {
  metadata: UrlMetadataDTO
}
