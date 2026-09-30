import type { EntityId, ISODateTimeString } from './primitives'

/**
 * 标签 DTO。对齐 backend `GET /tags` 与 `GET /tags/:id` 的 wire:
 * `click_count` 与 `bookmark_count` 均直读 tags 列——bookmark_count 是由
 * sql/04_tags.sql 触发器维护的计数(活书签数,墓碑标签复活时重算)。
 */
export interface TagDTO {
  id: EntityId
  name: string
  color: string | null
  click_count: number
  bookmark_count: number
  created_at: ISODateTimeString
  updated_at: ISODateTimeString
}

/** 书签内联的标签子集(public 视图与书签 tags 数组均用此形状)。 */
export interface PublicTagDTO {
  id: EntityId
  name: string
  color: string | null
}

export interface TagFilterDTO extends PublicTagDTO {
  bookmark_count: number
}

export interface CreateTagInput {
  name: string
  color?: string
}

export interface UpdateTagInput {
  name?: string
  color?: string | null
}

type TagSort = 'usage' | 'name' | 'clicks'

export interface TagQueryParams {
  sort?: TagSort
}
