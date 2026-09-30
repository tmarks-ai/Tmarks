/**
 * 标签页组 wire 规范化:把 D1 原始行转为对齐 contracts 的输出 shape。
 * 删 `user_id`/`is_deleted`(内部列),`is_folder` number→boolean,
 * `tags` JSON string→string[],item 的 `is_pinned`/`is_todo`/`is_archived` number→boolean。
 */

interface TabGroupRow {
  id: string
  title: string
  color: string | null
  tags: string | null
  parent_id: string | null
  is_folder: number
  position: number
  created_at: string
  updated_at: string
  deleted_at: string | null
  is_locked?: number
}

interface TabGroupItemRow {
  id: string
  group_id: string
  title: string
  url: string
  favicon: string | null
  position: number
  created_at: string
  is_pinned?: number
  is_todo?: number
  is_archived?: number
  is_locked?: number
}

interface TabGroupWire {
  id: string
  title: string
  color: string | null
  tags: string[]
  parent_id: string | null
  is_folder: boolean
  position: number
  item_count: number
  created_at: string
  updated_at: string
  deleted_at: string | null
  is_locked?: boolean
  items?: TabGroupItemWire[]
}

interface TabGroupItemWire {
  id: string
  group_id: string
  title: string
  url: string
  favicon: string | null
  position: number
  created_at: string
  is_pinned?: boolean
  is_todo?: boolean
  is_archived?: boolean
  is_locked?: boolean
}

/** 解析 tags JSON 字符串为 string[];空/异常返回空数组。 */
export function parseTags(tags: string | null): string[] {
  if (!tags) return []
  try {
    const parsed: unknown = JSON.parse(tags)
    return Array.isArray(parsed) ? parsed.map((t) => String(t)) : []
  } catch {
    return []
  }
}

/** 规范化标签页条目:number 标志位 → boolean(仅当非 null/undefined)。 */
export function normalizeTabGroupItem(row: TabGroupItemRow): TabGroupItemWire {
  const item: TabGroupItemWire = {
    id: row.id,
    group_id: row.group_id,
    title: row.title,
    url: row.url,
    favicon: row.favicon,
    position: row.position,
    created_at: row.created_at,
  }
  if (row.is_pinned !== undefined && row.is_pinned !== null) item.is_pinned = Boolean(row.is_pinned)
  if (row.is_todo !== undefined && row.is_todo !== null) item.is_todo = Boolean(row.is_todo)
  if (row.is_archived !== undefined && row.is_archived !== null) item.is_archived = Boolean(row.is_archived)
  if (row.is_locked !== undefined && row.is_locked !== null) item.is_locked = Boolean(row.is_locked)
  return item
}

/** 规范化标签页组:显式构造(删内部列),items 可选(列表/详情嵌套,回收站仅 count)。 */
export function normalizeTabGroup(
  row: TabGroupRow,
  items?: TabGroupItemRow[],
  itemCount?: number,
): TabGroupWire {
  const group: TabGroupWire = {
    id: row.id,
    title: row.title,
    color: row.color,
    tags: parseTags(row.tags),
    parent_id: row.parent_id,
    is_folder: row.is_folder === 1,
    position: row.position,
    item_count: itemCount ?? items?.length ?? 0,
    created_at: row.created_at,
    updated_at: row.updated_at,
    deleted_at: row.deleted_at,
  }
  if (row.is_locked !== undefined && row.is_locked !== null) group.is_locked = Boolean(row.is_locked)
  // Always include the key: omitting it for empty groups made the response
  // shape vary run-to-run for the same group.
  group.items = items ? items.map(normalizeTabGroupItem) : []
  return group
}
