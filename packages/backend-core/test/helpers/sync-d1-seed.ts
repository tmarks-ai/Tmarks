import type { SyncBookmarkRow } from './sync-d1-types'
import type { SyncMemoryD1Database } from './sync-d1-memory'

export function asD1(db: SyncMemoryD1Database): D1Database {
  return db as unknown as D1Database
}

export function seedBookmark(
  db: SyncMemoryD1Database,
  bookmark: Partial<SyncBookmarkRow> & {
    id: string
    user_id: string
    title: string
    url: string
    revision: string
  },
) {
  const now = new Date().toISOString()
  db.bookmarks.set(bookmark.id, {
    description: null,
    normalized_url: null,
    folder_id: null,
    cover_image: null,
    favicon: null,
    is_pinned: 0,
    pin_order: 0,
    click_count: 0,
    last_clicked_at: null,
    created_at: now,
    updated_at: now,
    deleted_at: null,
    ...bookmark,
  })
}
