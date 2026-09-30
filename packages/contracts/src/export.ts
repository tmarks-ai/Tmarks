// Export data + option contracts for the TMarks JSON export flow. The import
// side (browser-extension import) is intentionally out of scope here and lives
// with the extension when needed.

export interface ExportBookmark {
  id: string
  folder_id?: string | null
  title: string
  url: string
  description?: string | null
  cover_image?: string | null
  favicon?: string | null
  tags: string[]
  is_pinned: boolean
  is_archived?: boolean
  created_at: string
  updated_at: string
  click_count?: number
  last_clicked_at?: string | null
  deleted_at?: string | null
}

export interface ExportBookmarkFolder {
  id: string
  name: string
  parent_id?: string | null
  position: number
  is_deleted?: boolean
  deleted_at?: string | null
  created_at: string
  updated_at: string
}

export interface ExportTag {
  id: string
  name: string
  color: string
  click_count?: number
  last_clicked_at?: string | null
  created_at: string
  updated_at: string
  deleted_at?: string | null
  bookmark_count?: number
}

export interface ExportTabGroupItem {
  id: string
  title: string
  url: string
  favicon?: string
  position: number
  is_pinned: boolean
  is_todo: boolean
  is_archived: boolean
  created_at: string
}

export interface ExportTabGroup {
  id: string
  title: string
  parent_id?: string
  is_folder: boolean
  position: number
  color?: string
  tags?: string[]
  is_deleted?: boolean
  deleted_at?: string
  created_at: string
  updated_at: string
  items: ExportTabGroupItem[]
}

type ExportFormat = 'json'

export interface TMarksExportData {
  version: string
  format: 'tmarks'
  exported_at: string
  bookmarks: ExportBookmark[]
  bookmark_folders: ExportBookmarkFolder[]
  tags: ExportTag[]
  tab_groups?: ExportTabGroup[]
  metadata?: {
    total_bookmarks: number
    total_bookmark_folders?: number
    total_tags: number
    total_tab_groups?: number
    export_format: ExportFormat
    source: 'tmarks'
  }
}

export type ExportScope = 'all' | 'bookmarks' | 'tab_groups'

export interface ExportStats {
  total_bookmarks: number
  total_bookmark_folders: number
  total_tags: number
  pinned_bookmarks: number
  total_tab_groups: number
}

export interface ExportOptions {
  include_tags: boolean
  include_metadata: boolean
  format_options: {
    pretty_print?: boolean
    include_click_stats?: boolean
  }
}

export const EXPORT_VERSION = '1.2.0'
