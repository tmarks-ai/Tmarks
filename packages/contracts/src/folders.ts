import type { EntityId, ISODateTimeString } from './primitives'

export interface BookmarkFolderDTO {
  id: EntityId
  user_id: EntityId
  name: string
  parent_id: EntityId | null
  position: number
  bookmark_count: number
  children?: BookmarkFolderDTO[]
  created_at: ISODateTimeString
  updated_at: ISODateTimeString
  deleted_at: ISODateTimeString | null
}

export interface PublicBookmarkFolderDTO {
  id: EntityId
  name: string
  parent_id: EntityId | null
  position: number
  bookmark_count: number
  children?: PublicBookmarkFolderDTO[]
  created_at: ISODateTimeString
  updated_at: ISODateTimeString
}

export interface CreateBookmarkFolderInput {
  name: string
  parent_id?: EntityId | null
}

export interface UpdateBookmarkFolderInput {
  name?: string
  parent_id?: EntityId | null
  position?: number
}

/** 重排序目录单条输入(POST /bookmark-folders/reorder,镜像书签重排)。parent_id 变更走既有 PATCH(层级校验单点)。 */
export interface ReorderBookmarkFolderItem {
  id: EntityId
  position: number
}

/** 重排序目录输入(POST /bookmark-folders/reorder)。 */
export interface ReorderBookmarkFoldersInput {
  updates: ReorderBookmarkFolderItem[]
}

/** 重排序目录结果(message + 实际更新条数)。 */
export interface ReorderBookmarkFoldersResult {
  message: string
  count: number
}
