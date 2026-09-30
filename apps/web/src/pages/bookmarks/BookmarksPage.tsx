import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { CheckSquare, Folder as FolderIcon, Plus, Tag as TagIcon, Trash2, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { BookmarkDTO, BookmarkFolderDTO, BookmarkQueryParams } from '@tmarks/contracts'
import { BookmarkWorkspaceLayout } from '@/components/bookmarks/workspace/BookmarkWorkspaceLayout'
import { BookmarkFolderPanel } from '@/components/bookmarks/folders/BookmarkFolderPanel'
import { TagSidebar } from '@/components/tags/TagSidebar'
import { BookmarkForm } from '@/components/bookmarks/BookmarkForm'
import { BatchActionBar } from '@/components/bookmarks/BatchActionBar'
import { PinnedBookmarksSection } from '@/components/bookmarks/PinnedBookmarksSection'
import { MoveBookmarkDialog } from '@/components/bookmarks/MoveBookmarkDialog'
import { MoveFolderDialog } from '@/components/bookmarks/MoveFolderDialog'
import { BookmarkStatusFilter } from '@/components/bookmarks/BookmarkStatusFilter'
import { findFolderById, getFolderFilterIds } from '@/components/bookmarks/folders/folderTree'
import { useAllPinnedBookmarks } from '@/hooks/useAllPinnedBookmarks'
import { useBookmarkFolders } from '@/hooks/useBookmarkFolders'
import { usePreferences, useUpdatePreferences } from '@/hooks/usePreferences'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'
import { Button } from '@/components/ui/button'
import {
  ALL_BOOKMARKS_FOLDER,
  UNCATEGORIZED_FOLDER,
  getPageSize,
  type BookmarkFolderFilter,
  type SortOption,
  type ViewMode,
} from '@/lib/constants/bookmarks'
import { useBookmarksState } from './hooks/useBookmarksState'
import { usePagedBookmarks } from './hooks/usePagedBookmarks'
import { useBookmarkActions } from './hooks/useBookmarkActions'

/** Stable identity so `queryParams` does not churn while the folders query loads. */
const EMPTY_FOLDERS: BookmarkFolderDTO[] = []

/** 书签工作区主页面:三栏 + 编辑表单 + folder/tag 过滤 + 批量操作 + 回收站入口。 */
export function BookmarksPage() {
  const { t } = useTranslation('bookmarks')
  useDocumentTitle(t('pageTitle'))
  const { data: preferencesData } = usePreferences()
  const updatePrefs = useUpdatePreferences()
  const prefPageSize = getPageSize(preferencesData?.preferences.page_size)
  const bookmarkNavMode = preferencesData?.preferences.bookmark_nav_mode ?? 'folders'
  const isTagsFirst = bookmarkNavMode === 'tags'
  // 外观设置作为工作区种子值(用户手动改过筛选后即尊重用户):
  // 此前 view_mode/sort_by/density/tag_layout 四项保存后无任何效果。
  const prefViewMode: ViewMode = preferencesData?.preferences.view_mode === 'minimal' ? 'minimal' : 'card'
  const prefSortBy: SortOption = preferencesData?.preferences.sort_by === 'updated' || preferencesData?.preferences.sort_by === 'popular'
    ? preferencesData.preferences.sort_by
    : 'created'
  const prefDensity = preferencesData?.preferences.density ?? 'normal'
  const prefTagLayout = preferencesData?.preferences.tag_layout === 'masonry' ? 'masonry' : 'grid'
  const filterDefaults = useMemo(() => ({ viewMode: prefViewMode, sortBy: prefSortBy }), [prefViewMode, prefSortBy])
  const state = useBookmarksState(filterDefaults)
  const {
    selectedTags, setSelectedTags, debouncedSelectedTags,
    searchMode, setSearchMode, searchKeyword, setSearchKeyword, debouncedSearchKeyword,
    statusFilter, setStatusFilter,
    sortBy, handleSortChange, viewMode, handleViewModeChange,
    showForm, setShowForm, editingBookmark, setEditingBookmark,
    dialog, openMoveBookmark, openMoveFolder, closeDialog,
    batchMode, setBatchMode, selection,
  } = state
  const { selectedIds, selectedBookmarks, toggle: toggleSelectBookmark, selectAll: selectAllBookmarks, clear: clearSelection } = selection

  const [selectedFolderId, setSelectedFolderId] = useState<BookmarkFolderFilter>(ALL_BOOKMARKS_FOLDER)
  const { data: foldersData, isLoading: foldersLoading, isError: foldersError, refetch: refetchFolders } = useBookmarkFolders()
  // `?? EMPTY_FOLDERS` rather than `?? []`: a fresh array on every render feeds
  // queryParams below, whose identity change resets selection, which re-renders
  // — an endless loop for as long as the folders query is pending or errored.
  const folders = foldersData?.folders ?? EMPTY_FOLDERS
  const totalCount = foldersData?.total_count ?? 0
  const uncategorizedCount = foldersData?.uncategorized_count ?? 0

  const queryParams = useMemo<BookmarkQueryParams>(() => {
    const params: BookmarkQueryParams = { sort: sortBy }
    if (searchMode === 'bookmark' && debouncedSearchKeyword.trim()) {
      params.keyword = debouncedSearchKeyword.trim()
    }
    if (debouncedSelectedTags.length > 0) {
      params.tags = debouncedSelectedTags.join(',')
    }
    if (selectedFolderId !== ALL_BOOKMARKS_FOLDER) {
      params.folder_id =
        selectedFolderId === UNCATEGORIZED_FOLDER
          ? 'none'
          : getFolderFilterIds(folders, selectedFolderId).join(',')
    }
    if (statusFilter !== 'all') params.status = statusFilter
    return params
  }, [searchMode, debouncedSearchKeyword, debouncedSelectedTags, sortBy, selectedFolderId, folders, statusFilter])

  const bookmarksPage = usePagedBookmarks(queryParams, prefPageSize)
  const bookmarks = bookmarksPage.bookmarks
  const isInitialLoading = bookmarksPage.query.isLoading && bookmarks.length === 0
  // 置顶 Dock 全局化:专用 pinned-only 查询按 pin_order 拉全量置顶(此前只过滤当前页,翻页即"消失"、重排只发子集却赋全局 pin_order)。
  // R5-12: useBookmarks 的后端默认页大小把 Dock 截断在 100 条——第 101+ 条置顶
  // 既不在主网格也不在 Dock 里,且重排只发已加载子集会污染未加载行的 pin_order。
  // useAllPinnedBookmarks 走游标循环拉全量,Dock 渲染完整集、重排发送全序。
  const pinnedQuery = useAllPinnedBookmarks(sortBy)

  const filteredBookmarks = bookmarks

  // 仅在筛选/搜索/目录条件变化时清空已选;翻页(仅 currentPage 变)时保留,避免选中状态被意外重置。
  useEffect(() => {
    clearSelection()
  }, [queryParams, clearSelection])

  const actions = useBookmarkActions(closeDialog)
  const { togglePin: handleTogglePin, toggleTodo: handleToggleTodo, toggleArchive: handleToggleArchive } = actions

  const handleMoveBookmark = (targetFolderId: string | null) => {
    if (dialog?.type !== 'moveBookmark') return
    actions.moveBookmark(dialog.bookmark.id, targetFolderId)
  }
  const handleMoveFolder = (targetParentId: string | null) => {
    if (dialog?.type !== 'moveFolder') return
    actions.moveFolder(dialog.folder.id, targetParentId)
  }
  const handleReorder = actions.reorder

  const isFiltering =
    (searchMode === 'bookmark' && debouncedSearchKeyword.trim() !== '') ||
    debouncedSelectedTags.length > 0 ||
    selectedFolderId !== ALL_BOOKMARKS_FOLDER ||
    statusFilter !== 'all'
  const hasActiveFilters =
    searchKeyword.trim() !== '' ||
    selectedTags.length > 0 ||
    selectedFolderId !== ALL_BOOKMARKS_FOLDER ||
    statusFilter !== 'all'
  const clearFilters = () => {
    setSearchKeyword('')
    setSelectedTags([])
    setSelectedFolderId(ALL_BOOKMARKS_FOLDER)
    setStatusFilter('all')
  }
  const showPinned = !isFiltering && !batchMode
  const pinnedBookmarks = showPinned ? (pinnedQuery.data ?? []) : []
  const mainBookmarks = showPinned
    ? filteredBookmarks.filter((bookmark) => !bookmark.is_pinned)
    : filteredBookmarks
  const pinnedSlot =
    pinnedBookmarks.length > 0 ? (
      <PinnedBookmarksSection bookmarks={pinnedBookmarks} onUnpin={handleTogglePin} />
    ) : null

  const dndEnabled =
    sortBy === 'manual' &&
    viewMode === 'minimal' &&
    !batchMode &&
    !(searchMode === 'bookmark' && debouncedSearchKeyword.trim()) &&
    debouncedSelectedTags.length === 0 &&
    selectedFolderId !== ALL_BOOKMARKS_FOLDER &&
    statusFilter === 'all' && (findFolderById(folders, selectedFolderId)?.children ?? []).length === 0 &&
    // 拖拽=对可见子集赋 0..n 绝对 position(后端按全目录排序):仅当前页=结果全集且无置顶行拆出时子集才是全集,否则其余行被挤到目录后方。
    !bookmarksPage.pagination.hasNextPage && !bookmarksPage.pagination.hasPreviousPage && bookmarks.length === mainBookmarks.length

  const closeForm = () => { setShowForm(false); setEditingBookmark(null) }
  const openCreate = () => { setEditingBookmark(null); setShowForm(true) }
  const formOpen = showForm || Boolean(editingBookmark)

  const toggleSelect = (id: string) => {
    const bookmark = filteredBookmarks.find((b) => b.id === id)
    if (bookmark) toggleSelectBookmark(bookmark)
  }
  const selectAll = () => selectAllBookmarks(filteredBookmarks)
  const toggleBatch = () => { setBatchMode((b) => !b); clearSelection() }

  const folderPanel = (
    <BookmarkFolderPanel
      folders={folders}
      selectedId={selectedFolderId}
      totalCount={totalCount}
      uncategorizedCount={uncategorizedCount}
      isLoading={foldersLoading}
      isError={foldersError}
      onRetry={() => void refetchFolders()}
      onSelect={setSelectedFolderId}
      onMove={openMoveFolder}
    />
  )
  const tagPanel = (
    <TagSidebar
      selectedTags={selectedTags}
      onTagsChange={setSelectedTags}
      bookmarks={bookmarks}
      searchQuery={searchMode === 'tag' ? searchKeyword : ''}
      relatedTagIds={bookmarksPage.relatedTagIds}
      layout={prefTagLayout}
    />
  )
  const statusFilterControl = <BookmarkStatusFilter value={statusFilter} onChange={setStatusFilter} />

  return (
    <>

      <h1 className="sr-only">{t('pageTitle')}</h1>    <BookmarkWorkspaceLayout
      bookmarks={mainBookmarks}
      isLoading={isInitialLoading}
      isError={bookmarksPage.query.isError}
      onRetry={() => bookmarksPage.query.refetch()}
      pagination={{ ...bookmarksPage.pagination, pageSize: prefPageSize, onPageSizeChange: (size: number) => updatePrefs.mutate({ page_size: size }) }}
      searchMode={searchMode}
      onSearchModeToggle={() => setSearchMode((mode) => (mode === 'bookmark' ? 'tag' : 'bookmark'))}
      searchKeyword={searchKeyword}
      onSearchKeywordChange={setSearchKeyword}
      sortBy={sortBy}
      onSortByChange={handleSortChange}
      viewMode={viewMode}
      onViewModeChange={handleViewModeChange}
      density={prefDensity}
      onEdit={(bookmark: BookmarkDTO) => setEditingBookmark(bookmark)}
      onTogglePin={handleTogglePin}
      onToggleTodo={handleToggleTodo}
      onToggleArchive={handleToggleArchive}
      onMove={openMoveBookmark}
      sortable={dndEnabled}
      onReorder={handleReorder}
      pinnedSlot={pinnedSlot}
      filterControl={statusFilterControl}
      batchMode={batchMode}
      selectedIds={selectedIds}
      onToggleSelect={toggleSelect}
      isFiltering={isFiltering}
      onClearFilters={clearFilters}
      navigationMode={bookmarkNavMode}
      leftPanel={isTagsFirst ? tagPanel : folderPanel}
      rightPanel={isTagsFirst ? folderPanel : tagPanel}
      mobilePanels={isTagsFirst ? [
        { key: 'tags', title: t('tags.title'), icon: <TagIcon className="h-4 w-4" />, content: tagPanel },
        { key: 'folders', title: t('folders.title'), icon: <FolderIcon className="h-4 w-4" />, content: folderPanel, side: 'right' },
      ] : [
        { key: 'folders', title: t('folders.title'), icon: <FolderIcon className="h-4 w-4" />, content: folderPanel },
        { key: 'tags', title: t('tags.title'), icon: <TagIcon className="h-4 w-4" />, content: tagPanel, side: 'right' },
      ]}
      extraActions={
        <>
          {hasActiveFilters && (
            <Button
              variant="ghost"
              size="icon"
              onClick={clearFilters}
              title={t('workspace.clearAll')}
              aria-label={t('workspace.clearAll')}
            >
              <X className="h-4 w-4" />
            </Button>
          )}
          <Link to="/bookmarks/trash">
            <Button variant="ghost" size="icon" aria-label={t('toolbar.trash')}>
              <Trash2 className="h-4 w-4" />
            </Button>
          </Link>
          <Button
            variant={batchMode ? 'secondary' : 'ghost'}
            size="icon"
            onClick={toggleBatch}
            aria-label={batchMode ? t('toolbar.exitBatchMode') : t('toolbar.batchMode')}
          >
            <CheckSquare className="h-4 w-4" />
          </Button>
          <Button size="icon" onClick={openCreate} aria-label={t('toolbar.addBookmark')}>
            <Plus className="h-4 w-4" />
          </Button>
        </>
      }
      footerSlot={
        formOpen
          ? <BookmarkForm bookmark={editingBookmark} onClose={closeForm} />
          : batchMode
            ? <BatchActionBar
                selectedBookmarks={selectedBookmarks}
                totalCount={filteredBookmarks.length}
                onSelectAll={selectAll}
                onClearSelection={clearSelection}
              />
            : null
      }
    />
    <MoveBookmarkDialog
      isOpen={dialog?.type === 'moveBookmark'}
      bookmark={dialog?.type === 'moveBookmark' ? dialog.bookmark : null}
      folders={folders}
      isSubmitting={actions.isMovingBookmark}
      onConfirm={handleMoveBookmark}
      onCancel={closeDialog}
    />
    <MoveFolderDialog
      isOpen={dialog?.type === 'moveFolder'}
      folder={dialog?.type === 'moveFolder' ? dialog.folder : null}
      folders={folders}
      isSubmitting={actions.isMovingFolder}
      onConfirm={handleMoveFolder}
      onCancel={closeDialog}
    />
    </>
  )
}
