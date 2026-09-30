import type { Bookmark } from '../types'

interface TrashTag {
  id: string
  name: string
  color: string | null
}

export type TrashBookmark = Bookmark & { tags: TrashTag[] }

export interface TrashBookmarksData {
  bookmarks: TrashBookmark[]
  meta: {
    total: number
    page_size: number
    has_more: boolean
    next_cursor: string | null
  }
}
