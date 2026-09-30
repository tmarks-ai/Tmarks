import type { ISODateTimeString } from './primitives'

export type ThemePreference = 'light' | 'dark' | 'system'
export type ViewModePreference = 'card' | 'minimal'
export type DensityPreference = 'compact' | 'normal' | 'comfortable'
export type TagLayoutPreference = 'grid' | 'masonry'
export type SortByPreference = 'created' | 'updated' | 'popular'
export type BookmarkNavModePreference = 'folders' | 'tags'
export type BookmarkAuxPanelPreference = 'right' | 'drawer' | 'hidden'

export interface UserPreferencesDTO {
  theme: ThemePreference
  page_size: number
  view_mode: ViewModePreference
  density: DensityPreference
  tag_layout: TagLayoutPreference
  sort_by: SortByPreference
  bookmark_nav_mode: BookmarkNavModePreference
  bookmark_aux_panel: BookmarkAuxPanelPreference
  search_auto_clear_seconds: number
  tag_selection_auto_clear_seconds: number
  enable_search_auto_clear: boolean
  enable_tag_selection_auto_clear: boolean
  default_bookmark_icon: string
  updated_at: ISODateTimeString
}

export interface PreferencesResponse {
  preferences: UserPreferencesDTO
  sync?: {
    revision: string | null
    cursor: string | null
  }
}

export interface UpdatePreferencesInput {
  theme?: ThemePreference
  page_size?: number
  view_mode?: ViewModePreference
  density?: DensityPreference
  tag_layout?: TagLayoutPreference
  sort_by?: SortByPreference
  bookmark_nav_mode?: BookmarkNavModePreference
  bookmark_aux_panel?: BookmarkAuxPanelPreference
  search_auto_clear_seconds?: number
  tag_selection_auto_clear_seconds?: number
  enable_search_auto_clear?: boolean
  enable_tag_selection_auto_clear?: boolean
  default_bookmark_icon?: string
}

const DEFAULT_BOOKMARK_ICONS = ['orbital-spinner'] as const
type DefaultBookmarkIcon = typeof DEFAULT_BOOKMARK_ICONS[number]

const DEFAULT_BOOKMARK_ICON: DefaultBookmarkIcon = 'orbital-spinner'

export function isDefaultBookmarkIcon(value: unknown): value is DefaultBookmarkIcon {
  return typeof value === 'string' && DEFAULT_BOOKMARK_ICONS.includes(value as DefaultBookmarkIcon)
}

export function normalizeDefaultBookmarkIcon(value: unknown): DefaultBookmarkIcon {
  return isDefaultBookmarkIcon(value) ? value : DEFAULT_BOOKMARK_ICON
}
