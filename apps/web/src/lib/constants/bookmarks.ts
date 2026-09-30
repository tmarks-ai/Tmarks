import type { BookmarkSort } from '@tmarks/contracts'

export const VIEW_MODES = ['card', 'minimal'] as const
export type ViewMode = (typeof VIEW_MODES)[number]

/** 排序选项沿用 contracts 的 BookmarkSort(与后端 list 路由一致)。 */
export type SortOption = BookmarkSort
export const SORT_OPTIONS: SortOption[] = ['created', 'updated', 'popular', 'manual']

export const VIEW_MODE_STORAGE_KEY = 'tmarks:view_mode'

export const PAGE_SIZE_OPTIONS = [20, 30, 50, 100, 200] as const
type PageSize = (typeof PAGE_SIZE_OPTIONS)[number]
export const DEFAULT_PAGE_SIZE: PageSize = 30

function isViewMode(value: unknown): value is ViewMode {
  return typeof value === 'string' && (VIEW_MODES as readonly string[]).includes(value)
}

export function normalizeViewMode(value: unknown, fallback: ViewMode = 'card'): ViewMode {
  if (value === 'title') return 'minimal'
  return isViewMode(value) ? value : fallback
}

export function getPageSize(value?: number | null): PageSize {
  return (PAGE_SIZE_OPTIONS as readonly number[]).includes(value as PageSize)
    ? (value as PageSize)
    : DEFAULT_PAGE_SIZE
}

/** 文件夹过滤的虚拟标识:全部书签 / 未分类。 */
export const ALL_BOOKMARKS_FOLDER = 'all'
export const UNCATEGORIZED_FOLDER = 'none'
export type BookmarkFolderFilter = typeof ALL_BOOKMARKS_FOLDER | typeof UNCATEGORIZED_FOLDER | string
