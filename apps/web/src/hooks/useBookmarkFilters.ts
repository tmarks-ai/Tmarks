import { useCallback, useEffect, useRef, useState } from 'react'
import type { BookmarkStatusFilter } from '@tmarks/contracts'
import {
  SORT_OPTIONS,
  VIEW_MODES,
  VIEW_MODE_STORAGE_KEY,
  normalizeViewMode,
  type SortOption,
  type ViewMode,
} from '@/lib/constants/bookmarks'

function getStoredViewMode(): ViewMode | null {
  if (typeof window === 'undefined') return null
  const stored = window.localStorage.getItem(VIEW_MODE_STORAGE_KEY)
  return stored ? normalizeViewMode(stored, 'card') : null
}

function setStoredViewMode(mode: ViewMode): void {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(VIEW_MODE_STORAGE_KEY, mode)
}

/** 外观偏好的种子值:用户手动改过(或本机有 localStorage 覆盖)后不再生效。 */
export interface BookmarkFilterDefaults {
  viewMode?: ViewMode
  sortBy?: SortOption
}

/** 书签筛选状态:标签/关键词(防抖)、搜索模式、状态筛选、排序、视图模式、可见性。 */
export function useBookmarkFilters(defaults?: BookmarkFilterDefaults) {
  const [selectedTags, setSelectedTags] = useState<string[]>([])
  const [debouncedSelectedTags, setDebouncedSelectedTags] = useState<string[]>([])
  const [searchKeyword, setSearchKeyword] = useState('')
  const [debouncedSearchKeyword, setDebouncedSearchKeyword] = useState('')
  const [searchMode, setSearchMode] = useState<'bookmark' | 'tag'>('bookmark')
  const [statusFilter, setStatusFilter] = useState<BookmarkStatusFilter>('all')
  const [sortBy, setSortBy] = useState<SortOption>(defaults?.sortBy ?? 'created')
  const [viewMode, setViewMode] = useState<ViewMode>(() => getStoredViewMode() ?? defaults?.viewMode ?? 'card')
  // 偏好异步晚于首渲染到达:用户没动过前用偏好补种子,动过(或有本机覆盖)就尊重用户。
  const touchedRef = useRef({ view: getStoredViewMode() !== null, sort: false })
  const defaultView = defaults?.viewMode
  const defaultSort = defaults?.sortBy
  useEffect(() => {
    if (!touchedRef.current.view && defaultView) setViewMode(defaultView)
  }, [defaultView])
  useEffect(() => {
    if (!touchedRef.current.sort && defaultSort) setSortBy(defaultSort)
  }, [defaultSort])

  const tagDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (tagDebounceRef.current) clearTimeout(tagDebounceRef.current)
    tagDebounceRef.current = setTimeout(() => setDebouncedSelectedTags(selectedTags), 300)
    return () => {
      if (tagDebounceRef.current) clearTimeout(tagDebounceRef.current)
    }
  }, [selectedTags])

  useEffect(() => {
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current)
    searchDebounceRef.current = setTimeout(() => setDebouncedSearchKeyword(searchKeyword), 400)
    return () => {
      if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current)
    }
  }, [searchKeyword])

  const handleViewModeChange = useCallback(() => {
    const idx = VIEW_MODES.indexOf(viewMode)
    const next = VIEW_MODES[(idx + 1) % VIEW_MODES.length]!
    touchedRef.current.view = true
    setViewMode(next)
    setStoredViewMode(next)
    return next
  }, [viewMode])

  const handleSortChange = useCallback(() => {
    const idx = SORT_OPTIONS.indexOf(sortBy)
    const next = SORT_OPTIONS[(idx + 1) % SORT_OPTIONS.length]!
    touchedRef.current.sort = true
    setSortBy(next)
    return next
  }, [sortBy])

  return {
    selectedTags,
    setSelectedTags,
    debouncedSelectedTags,
    searchKeyword,
    setSearchKeyword,
    debouncedSearchKeyword,
    searchMode,
    setSearchMode,
    statusFilter,
    setStatusFilter,
    sortBy,
    // 排序/视图只经 handleXxx 修改:裸 setState 会绕过 touchedRef 布防,
    // 用户手动改过之后异步到达的偏好种子又能把它覆盖回去(故不导出)。
    handleSortChange,
    viewMode,
    handleViewModeChange,
  }
}
