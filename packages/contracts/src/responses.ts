import type { EntityId, ISODateTimeString } from './primitives'
import type { BookmarkFolderDTO } from './folders'
import type { BookmarkDTO, TrashBookmark } from './bookmarks'
import type { TagDTO } from './tags'
import type { TabGroupDTO, TabGroupItemDTO } from './tab-groups'

/**
 * 列表分页 meta。实际线上嵌在 `data.meta` 内(非顶层 ApiResponse meta),
 * 字段来自 `backend-core` 各 list 路由(`bookmarks/list.ts`、`tab-groups/list.ts` 等)。
 */
interface ListMeta {
  page_size: number
  count: number
  next_cursor: string | null
  has_more: boolean
}

/** 书签列表 meta,额外携带当前过滤命中的 related_tag_ids。 */
interface BookmarksListMeta extends ListMeta {
  related_tag_ids: string[]
}

/** 书签列表响应。 */
export interface BookmarksResponse {
  bookmarks: BookmarkDTO[]
  meta: BookmarksListMeta
}

/** 标签列表响应。 */
export interface TagsResponse {
  tags: TagDTO[]
}

/** 文件夹列表响应:树 + 扁平 + 统计。 */
export interface FoldersResponse {
  folders: BookmarkFolderDTO[]
  flat_folders: BookmarkFolderDTO[]
  total_count: number
  uncategorized_count: number
}

/** 回收站列表 meta:用 total(而非 count)表示回收站总数。 */
interface TrashMeta {
  total: number
  page_size: number
  has_more: boolean
  next_cursor: string | null
}

/** 回收站列表响应。 */
export interface TrashResponse {
  bookmarks: TrashBookmark[]
  meta: TrashMeta
}

/** 书签点击响应(POST /:id/click)。 */
export interface ClickResponse {
  message: string
  clicked_at: ISODateTimeString
}

/** 清空回收站响应。 */
export interface EmptyTrashResponse {
  message: string
  count: number
}

/** 批量创建结果。 */
export interface BatchCreateResult {
  import_batch_id: string
  total: number
  success: number
  failed: number
  skipped: number
  errors: Array<{ index: number; url: string; error: string }>
  created_bookmarks: Array<{
    id: EntityId
    url: string
    title: string
    status: 'created' | 'restored'
  }>
  skipped_bookmarks: Array<{ index: number; url: string; reason: string }>
}

/** 标签页组列表响应(GET /tab-groups,游标分页,meta 复用通用 ListMeta)。 */
export interface TabGroupsResponse {
  tab_groups: TabGroupDTO[]
  meta: ListMeta
}

/** 标签页组详情响应(GET /:id、POST create、PATCH update,嵌套 items)。 */
export interface TabGroupDetailResponse {
  tab_group: TabGroupDTO
}

/** 标签页组回收站响应(GET /trash,仅 total + item_count,无 items)。 */
export interface TabGroupTrashResponse {
  tab_groups: TabGroupDTO[]
  total: number
}

/** 标签页条目响应(PATCH /items/:itemId、POST /items/:itemId/move)。 */
export interface TabGroupItemResponse {
  item: TabGroupItemDTO
  message: string
}

/** 批量加入条目响应(POST /:id/items/batch)。 */
export interface AddTabGroupItemsResponse {
  message: string
  added_count: number
}
