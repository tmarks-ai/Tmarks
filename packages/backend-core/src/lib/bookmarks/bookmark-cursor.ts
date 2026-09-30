import type { BookmarkListRow } from './bookmark-list'

export type { BookmarkListRow }

export type BookmarkSort = 'created' | 'updated' | 'popular' | 'manual'

export interface BookmarkPageCursor {
  id: string
  isPinned: boolean
  pinOrder: number | null
  sortValue: string | number
}

/** JSON-shaped cursors that fail to parse or lack the expected fields return
 * null here; the caller ignores them entirely (first page) instead of falling
 * back to the legacy raw-id comparison. */
export function parseBookmarkPageCursor(raw: string | null): BookmarkPageCursor | null {
  if (!raw) return null

  try {
    const parsed = JSON.parse(raw) as Partial<BookmarkPageCursor>
    if (
      typeof parsed?.id === 'string' &&
      typeof parsed?.isPinned === 'boolean' &&
      (typeof parsed?.sortValue === 'string' || typeof parsed?.sortValue === 'number') &&
      (typeof parsed?.pinOrder === 'number' || parsed?.pinOrder === null || parsed?.pinOrder === undefined)
    ) {
      return {
        id: parsed.id,
        isPinned: parsed.isPinned,
        pinOrder: typeof parsed.pinOrder === 'number' ? parsed.pinOrder : null,
        sortValue: parsed.sortValue,
      }
    }
  } catch {
    return null
  }

  return null
}

/** Distinguishes JSON cursors from legacy plain-id cursors (which were never JSON). */
export function looksLikeJsonCursor(raw: string): boolean {
  const trimmed = raw.trim()
  return trimmed.startsWith('{') || trimmed.startsWith('[')
}

export function createBookmarkPageCursor(row: BookmarkListRow, sortBy: BookmarkSort): string {
  return JSON.stringify({
    id: row.id,
    isPinned: Boolean(row.is_pinned),
    pinOrder: row.is_pinned ? Number(row.pin_order ?? 0) : null,
    sortValue: getBookmarkSortValue(row, sortBy),
  } satisfies BookmarkPageCursor)
}

export function normalizeBookmarkSort(value: string | null): BookmarkSort {
  if (value === 'manual') return 'manual'
  if (value === 'updated' || value === 'popular') return value
  return 'created'
}

/** 排序列表达式。popular 用裸 click_count 列(NOT NULL,COALESCE 多余且会
 * 阻断索引序)——两臂查询依赖它吃到 (user_id, is_pinned, click_count) 索引。 */
export function getBookmarkSortField(sortBy: BookmarkSort): string {
  if (sortBy === 'manual') return 'b.position'
  if (sortBy === 'updated') return 'b.updated_at'
  if (sortBy === 'popular') return 'b.click_count'
  return 'b.created_at'
}

export function getBookmarkSortValue(row: BookmarkListRow, sortBy: BookmarkSort): string | number {
  if (sortBy === 'manual') return Number(row.position ?? 0)
  if (sortBy === 'updated') return row.updated_at
  if (sortBy === 'popular') return Number(row.click_count || 0)
  return row.created_at
}
