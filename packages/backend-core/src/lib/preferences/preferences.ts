import {
  type UserPreferencesDTO,
  type UpdatePreferencesInput,
  type ThemePreference,
  type ViewModePreference,
  type DensityPreference,
  type TagLayoutPreference,
  type SortByPreference,
  type BookmarkNavModePreference,
  type BookmarkAuxPanelPreference,
  isDefaultBookmarkIcon,
  normalizeDefaultBookmarkIcon,
} from '@tmarks/contracts'

/**
 * D1 `user_preferences` row. The schema is single-sourced and kept current by
 * the migration gate, so every column below always exists — the legacy
 * per-column existence probes are intentionally dropped (no fail-open).
 *
 * `view_mode`/`sort_by` accept legacy stored values (`title`, `pinned`) that are
 * normalized away by {@link mapPreferences} before leaving the backend.
 */
type StoredViewMode = ViewModePreference | 'title'
type StoredSortBy = SortByPreference | 'pinned'

export interface UserPreferences {
  user_id: string
  theme: ThemePreference
  page_size: number
  view_mode: StoredViewMode
  density: DensityPreference
  tag_layout: TagLayoutPreference
  sort_by: StoredSortBy
  bookmark_nav_mode: BookmarkNavModePreference
  bookmark_aux_panel: BookmarkAuxPanelPreference
  search_auto_clear_seconds: number
  tag_selection_auto_clear_seconds: number
  enable_search_auto_clear: number
  enable_tag_selection_auto_clear: number
  default_bookmark_icon: string
  updated_at: string
}

export function mapPreferences(row: UserPreferences): UserPreferencesDTO {
  return {
    theme: row.theme,
    page_size: row.page_size,
    view_mode: normalizeViewMode(row.view_mode),
    density: row.density,
    tag_layout: row.tag_layout,
    sort_by: normalizeSortBy(row.sort_by),
    bookmark_nav_mode: row.bookmark_nav_mode,
    bookmark_aux_panel: row.bookmark_aux_panel,
    search_auto_clear_seconds: row.search_auto_clear_seconds,
    tag_selection_auto_clear_seconds: row.tag_selection_auto_clear_seconds,
    enable_search_auto_clear: row.enable_search_auto_clear === 1,
    enable_tag_selection_auto_clear: row.enable_tag_selection_auto_clear === 1,
    default_bookmark_icon: normalizeDefaultBookmarkIcon(row.default_bookmark_icon),
    updated_at: row.updated_at,
  }
}

/** Validate a patch body; returns an error message or null when valid. */
export function validatePreferences(body: UpdatePreferencesInput): string | null {
  // 枚举字段一律用 !== undefined 判定:真值判断会让空串静默跳过校验写进库。
  if (body.theme !== undefined && !['light', 'dark', 'system'].includes(body.theme)) return 'Invalid theme value'
  if (body.page_size !== undefined && (body.page_size < 10 || body.page_size > 200)) {
    return 'Page size must be between 10 and 200'
  }
  if (body.view_mode !== undefined && !['card', 'minimal'].includes(body.view_mode)) return 'Invalid view mode'
  if (body.density !== undefined && !['compact', 'normal', 'comfortable'].includes(body.density)) {
    return 'Invalid density value'
  }
  if (body.tag_layout !== undefined && !['grid', 'masonry'].includes(body.tag_layout)) {
    return 'Invalid tag layout value'
  }
  if (body.sort_by !== undefined && !['created', 'updated', 'popular'].includes(body.sort_by)) {
    return 'Invalid sort_by value'
  }
  if (body.bookmark_nav_mode !== undefined && !['folders', 'tags'].includes(body.bookmark_nav_mode)) {
    return 'Invalid bookmark_nav_mode value'
  }
  if (body.bookmark_aux_panel !== undefined && !['right', 'drawer', 'hidden'].includes(body.bookmark_aux_panel)) {
    return 'Invalid bookmark_aux_panel value'
  }
  if (
    body.search_auto_clear_seconds !== undefined &&
    (body.search_auto_clear_seconds < 5 || body.search_auto_clear_seconds > 120)
  ) {
    return 'Search auto clear seconds must be between 5 and 120'
  }
  if (
    body.tag_selection_auto_clear_seconds !== undefined &&
    (body.tag_selection_auto_clear_seconds < 10 || body.tag_selection_auto_clear_seconds > 300)
  ) {
    return 'Tag selection auto clear seconds must be between 10 and 300'
  }
  if (body.default_bookmark_icon !== undefined && !isDefaultBookmarkIcon(body.default_bookmark_icon)) {
    return 'Invalid default bookmark icon value'
  }
  return null
}

function normalizeViewMode(value: StoredViewMode | undefined): ViewModePreference {
  if (value === 'title') return 'minimal'
  return value && ['card', 'minimal'].includes(value) ? value : 'card'
}

function normalizeSortBy(value: StoredSortBy | undefined): SortByPreference {
  if (value === 'pinned') return 'created'
  return value && ['created', 'updated', 'popular'].includes(value) ? value : 'popular'
}
