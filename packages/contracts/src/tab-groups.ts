import type { EntityId, ISODateTimeString } from './primitives'

/**
 * 标签页组 DTO。对齐 backend wire:`normalizeTabGroup(TabGroupRow)` 显式构造,
 * 删 `user_id`/`is_deleted`(内部列),`is_folder` number→boolean,`tags` JSON string→string[]。
 * list/get/create/update 嵌套 `items`;trash 仅 `item_count`(无 items)。
 */
export interface TabGroupDTO {
  id: EntityId
  title: string
  color: string | null
  tags: string[]
  parent_id: EntityId | null
  is_folder: boolean
  position: number
  item_count: number
  created_at: ISODateTimeString
  updated_at: ISODateTimeString
  deleted_at: ISODateTimeString | null
  is_locked?: boolean
  items?: TabGroupItemDTO[]
}

/**
 * 标签页组条目 DTO。`is_pinned`/`is_todo`/`is_archived` wire 为 number,
 * normalize 为 boolean(可选;DB 为 NULL/未设时缺省)。
 */
export interface TabGroupItemDTO {
  id: EntityId
  group_id: EntityId
  title: string
  url: string
  favicon: string | null
  position: number
  created_at: ISODateTimeString
  is_pinned?: boolean
  is_todo?: boolean
  is_archived?: boolean
  is_locked?: boolean
}

/** 标签页条目状态筛选(收纳页客户端筛选的取值)。 */
export type TabGroupItemStatusFilter = 'all' | 'todo' | 'pinned' | 'archived'

/** 创建标签页组输入(对齐 backend `CreateTabGroupRequest`)。 */
export interface CreateTabGroupInput {
  title?: string
  parent_id?: EntityId | null
  is_folder?: boolean
  items?: CreateTabGroupItemInput[]
}

/** 创建标签页条目输入(组创建时附带 / 批量加入)。 */
export interface CreateTabGroupItemInput {
  title: string
  url: string
  favicon?: string
}

/** 更新标签页组输入(对齐 backend `UpdateTabGroupRequest`)。 */
export interface UpdateTabGroupInput {
  title?: string
  color?: string | null
  tags?: string[] | null
  parent_id?: EntityId | null
  position?: number
  is_locked?: boolean
}

/** 更新标签页条目输入(对齐 backend `UpdateTabGroupItemRequest`)。 */
export interface UpdateTabGroupItemInput {
  title?: string
  is_pinned?: boolean
  is_todo?: boolean
  is_archived?: boolean
  position?: number
  is_locked?: boolean
}

/** 移动标签页条目输入(POST /items/:itemId/move)。 */
export interface MoveTabGroupItemInput {
  target_group_id: EntityId
  position?: number
}

/** 批量更新位置项(PATCH /batch-update,重排组在父级下的顺序)。 */
export interface BatchUpdatePositionItem {
  id: EntityId
  position: number
  parent_id?: EntityId | null
}

/** 批量操作标签页条目输入(POST /items/batch,action 区分 delete/update,max 100)。 */
export interface BatchTabGroupItemsInput {
  action: 'delete' | 'update'
  item_ids: string[]
  data?: { is_pinned?: boolean; is_todo?: boolean; is_archived?: boolean }
}

/** 批量操作标签页条目结果(message + deleted_count 或 updated_count 之一)。 */
export interface BatchTabGroupItemsResult {
  message: string
  deleted_count?: number
  updated_count?: number
}

/** 标签页组列表查询参数(游标分页,游标为 `created_at|id`)。 */
export interface TabGroupQueryParams {
  page_size?: number
  page_cursor?: string
}

/** 去重输入(dry_run=true 仅预览不删除,false 或缺省执行删除)。 */
export interface DedupTabGroupInput {
  dry_run?: boolean
}

/** 去重单个重复组:规范化 URL + 保留最早条目 id + 待删重复条目 id。 */
interface TabGroupDedupDuplicate {
  url: string
  kept_id: EntityId
  removed_ids: EntityId[]
}

/** 去重结果(removed=实际/将删条目数,duplicates=重复分组明细)。 */
export interface TabGroupDedupResult {
  removed: number
  duplicates: TabGroupDedupDuplicate[]
}
