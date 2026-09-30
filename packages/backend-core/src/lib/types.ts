export interface User {
  id: string
  username: string
  email: string | null
  password_hash: string
  created_at: string
  updated_at: string
}

export interface Bookmark {
  id: string
  user_id: string
  folder_id: string | null
  title: string
  url: string
  description: string | null
  cover_image: string | null
  favicon: string | null
  is_pinned: boolean
  is_archived: boolean
  is_todo: boolean
  is_private: boolean
  position: number
  pin_order: number | null
  click_count: number
  last_clicked_at: string | null
  revision: string | null
  created_at: string
  updated_at: string
  deleted_at: string | null
}

export interface BookmarkRow extends Omit<Bookmark, 'is_pinned' | 'is_archived' | 'is_todo' | 'is_private'> {
  is_pinned: number | boolean
  is_archived: number | boolean
  is_todo: number | boolean
  is_private: number | boolean
}

export interface BookmarkFolder {
  id: string
  user_id: string
  name: string
  parent_id: string | null
  position: number
  bookmark_count: number
  children?: BookmarkFolder[]
  created_at: string
  updated_at: string
  deleted_at?: string | null
}

export interface BookmarkFolderRow extends Omit<BookmarkFolder, 'bookmark_count' | 'children'> {
  bookmark_count?: number
  is_deleted?: number | boolean
}

export interface Tag {
  id: string
  user_id: string
  name: string
  color: string | null
  click_count: number
  last_clicked_at: string | null
  created_at: string
  updated_at: string
  deleted_at: string | null
}

export interface ApiError {
  code: string
  message: string
  details?: unknown
  // Error envelopes carry varied detail fields (e.g. `required`/`available`
  // for permission errors) alongside the standard code/message pair.
  [key: string]: unknown
}

export interface ApiResponse<T = unknown> {
  data?: T
  error?: ApiError
  meta?: {
    page?: number
    page_size?: number
    total?: number
    next_cursor?: string
  }
}

export type SQLParam = string | number | boolean | null
