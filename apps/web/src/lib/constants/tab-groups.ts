/** 标签页收纳排序选项:created(服务端 created_at DESC)/ title / count(本地展示排序)。 */
export const SORT_OPTIONS = ['created', 'title', 'count'] as const
export type TabGroupSortOption = (typeof SORT_OPTIONS)[number]

export const PAGE_SIZE_OPTIONS = [20, 30, 50, 100] as const
type TabGroupPageSize = (typeof PAGE_SIZE_OPTIONS)[number]
export const DEFAULT_PAGE_SIZE: TabGroupPageSize = 30

/** 标签页组可选颜色色板(用于 ColorTagEditor,与文件夹色点)。 */
export const TAB_GROUP_COLORS = [
  '#ef4444', // red
  '#f97316', // orange
  '#f59e0b', // amber
  '#eab308', // yellow
  '#22c55e', // green
  '#10b981', // emerald
  '#14b8a6', // teal
  '#3b82f6', // blue
  '#6366f1', // indigo
  '#8b5cf6', // violet
  '#ec4899', // pink
  '#64748b', // slate
] as const
