import type { Bookmark, BookmarkRow } from '../types'

/**
 * Coerce a raw D1 bookmark row into the canonical Bookmark shape:
 * 0/1 integer columns become booleans and nullable counters become numbers.
 */
export function normalizeBookmark(row: BookmarkRow): Bookmark {
  const { is_pinned, is_archived, is_todo, is_private, ...bookmark } = row
  return {
    ...bookmark,
    is_pinned: Boolean(is_pinned),
    is_archived: Boolean(is_archived),
    is_todo: Boolean(is_todo),
    is_private: Boolean(is_private),
    position: Number(row.position || 0),
    pin_order: row.pin_order === null ? null : Number(row.pin_order || 0),
    click_count: Number(row.click_count || 0),
    revision: row.revision ?? null,
  }
}

export interface BookmarkTagRef {
  id: string
  name: string
  color: string | null
}

export type BookmarkWithTags = Bookmark & { tags: BookmarkTagRef[] }
