import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useParams } from 'react-router-dom'
import { Folder as FolderIcon, Tag as TagIcon } from 'lucide-react'
import type { BookmarkDTO, BookmarkFolderDTO, PublicBookmarkDTO, PublicBookmarkFolderDTO } from '@tmarks/contracts'
import { BookmarkWorkspaceLayout } from '@/components/bookmarks/workspace/BookmarkWorkspaceLayout'
import { BookmarkFolderPanel } from '@/components/bookmarks/folders/BookmarkFolderPanel'
import { getFolderFilterIds } from '@/components/bookmarks/folders/folderTree'
import { TagSidebar } from '@/components/tags/TagSidebar'
import { publicShareService } from '@/services/public-share'
import { SORT_OPTIONS, VIEW_MODES, ALL_BOOKMARKS_FOLDER, UNCATEGORIZED_FOLDER, type BookmarkFolderFilter, type SortOption, type ViewMode } from '@/lib/constants/bookmarks'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'

// R5-P3: the public share is one unpaginated payload; rendering every row
// degraded smoothly into the thousands. Client-side pagination caps the DOM
// at one page of the filtered/sorted result.
const SHARE_PAGE_SIZE = 60

export function PublicSharePage() {
  const { slug = '' } = useParams<{ slug: string }>()
  const { t } = useTranslation('bookmarks')
  useDocumentTitle(t('public.pageTitle'))
  const query = useQuery({
    queryKey: ['public-share', slug],
    queryFn: () => publicShareService.getPage(slug),
    enabled: Boolean(slug),
  })
  const [selectedFolderId, setSelectedFolderId] = useState<BookmarkFolderFilter>(ALL_BOOKMARKS_FOLDER)
  const [selectedTags, setSelectedTags] = useState<string[]>([])
  const [searchMode, setSearchMode] = useState<'bookmark' | 'tag'>('bookmark')
  const [searchKeyword, setSearchKeyword] = useState('')
  const [sortBy, setSortBy] = useState<SortOption>('created')
  const [viewMode, setViewMode] = useState<ViewMode>('card')
  const [pageIndex, setPageIndex] = useState(0)
  const page = query.data?.page
  const bookmarks = useMemo(() => page?.bookmarks.map(toBookmark) ?? [], [page])
  const folders = useMemo(() => page?.folders.map(toFolder) ?? [], [page])
  const filteredBookmarks = useMemo(
    () => filterBookmarks(bookmarks, folders, selectedFolderId, selectedTags, searchMode, searchKeyword, sortBy),
    [bookmarks, folders, selectedFolderId, selectedTags, searchMode, searchKeyword, sortBy],
  )
  // Reset to the first page whenever the filter/sort inputs change.
  const resetKey = `${selectedFolderId}|${selectedTags.join(',')}|${searchMode}|${searchKeyword}|${sortBy}`
  useEffect(() => {
    setPageIndex(0)
  }, [resetKey])
  const totalPages = Math.max(1, Math.ceil(filteredBookmarks.length / SHARE_PAGE_SIZE))
  const safeIndex = Math.min(pageIndex, totalPages - 1)
  const pagedBookmarks = filteredBookmarks.slice(safeIndex * SHARE_PAGE_SIZE, safeIndex * SHARE_PAGE_SIZE + SHARE_PAGE_SIZE)

  if (query.isLoading || !page) {
    return query.isError ? <PublicShareError t={t} /> : <PublicShareLoading t={t} />
  }

  const isTagsFirst = page.workspace.nav_mode === 'tags'
  const paginationProps = filteredBookmarks.length > SHARE_PAGE_SIZE ? {
    currentPage: safeIndex + 1,
    currentCount: pagedBookmarks.length,
    hasPreviousPage: safeIndex > 0,
    hasNextPage: (safeIndex + 1) * SHARE_PAGE_SIZE < filteredBookmarks.length,
    onPreviousPage: () => setPageIndex((i) => Math.max(0, i - 1)),
    onNextPage: () => setPageIndex((i) => i + 1),
  } : undefined
  const folderPanel = (
    <BookmarkFolderPanel
      readOnly
      folders={folders}
      selectedId={selectedFolderId}
      totalCount={page.folder_stats.total_count}
      uncategorizedCount={page.folder_stats.uncategorized_count}
      onSelect={setSelectedFolderId}
    />
  )
  const tagPanel = (
    <TagSidebar
      readOnly
      providedTags={page.tags}
      selectedTags={selectedTags}
      onTagsChange={setSelectedTags}
      bookmarks={bookmarks}
      searchQuery={searchMode === 'tag' ? searchKeyword : ''}
    />
  )

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-shrink-0 items-start justify-between gap-4 px-4 pb-1 pt-3 sm:px-6 sm:pt-4">
        <div className="min-w-0">
          <h1 className="truncate text-xl font-bold text-primary sm:text-2xl">{page.share.title || 'TMarks'}</h1>
          {page.share.description && <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{page.share.description}</p>}
        </div>
        <span className="hidden flex-shrink-0 rounded-full border border-border/60 bg-card/70 px-3 py-1 text-xs text-muted-foreground sm:inline-flex">
          {t('public.readOnly')}
        </span>
      </div>
      <BookmarkWorkspaceLayout
        bookmarks={pagedBookmarks}
        pagination={paginationProps}
        isLoading={false}
        searchMode={searchMode}
        onSearchModeToggle={() => setSearchMode((mode) => mode === 'bookmark' ? 'tag' : 'bookmark')}
        searchKeyword={searchKeyword}
        onSearchKeywordChange={setSearchKeyword}
        sortBy={sortBy}
        onSortByChange={() => setSortBy(cycleValue(SORT_OPTIONS, sortBy))}
        viewMode={viewMode}
        onViewModeChange={() => setViewMode(cycleValue(VIEW_MODES, viewMode))}
        readOnly
        sortable={false}
        navigationMode={page.workspace.nav_mode}
        leftPanel={isTagsFirst ? tagPanel : folderPanel}
        rightPanel={isTagsFirst ? folderPanel : tagPanel}
        mobilePanels={isTagsFirst ? [
          { key: 'tags', title: t('tags.title'), icon: <TagIcon className="h-4 w-4" />, content: tagPanel },
          { key: 'folders', title: t('folders.title'), icon: <FolderIcon className="h-4 w-4" />, content: folderPanel, side: 'right' },
        ] : [
          { key: 'folders', title: t('folders.title'), icon: <FolderIcon className="h-4 w-4" />, content: folderPanel },
          { key: 'tags', title: t('tags.title'), icon: <TagIcon className="h-4 w-4" />, content: tagPanel, side: 'right' },
        ]}
      />
    </div>
  )
}

function filterBookmarks(
  bookmarks: BookmarkDTO[],
  folders: BookmarkFolderDTO[],
  selectedFolderId: BookmarkFolderFilter,
  selectedTags: string[],
  searchMode: 'bookmark' | 'tag',
  keyword: string,
  sortBy: SortOption,
) {
  const query = keyword.trim().toLowerCase()
  const folderIds = selectedFolderId !== ALL_BOOKMARKS_FOLDER && selectedFolderId !== UNCATEGORIZED_FOLDER
    ? new Set(getFolderFilterIds(folders, selectedFolderId))
    : null
  return bookmarks
    .filter((bookmark) => selectedFolderId === ALL_BOOKMARKS_FOLDER
      || (selectedFolderId === UNCATEGORIZED_FOLDER ? bookmark.folder_id === null : folderIds?.has(bookmark.folder_id ?? '') === true))
    .filter((bookmark) => selectedTags.every((tagId) => bookmark.tags.some((tag) => tag.id === tagId)))
    .filter((bookmark) => !query || searchMode === 'tag' || [bookmark.title, bookmark.url, bookmark.description ?? ''].some((value) => value.toLowerCase().includes(query)))
    .sort((a, b) => compareBookmarks(a, b, sortBy))
}

function compareBookmarks(a: BookmarkDTO, b: BookmarkDTO, sortBy: SortOption) {
  if (a.is_pinned !== b.is_pinned) return a.is_pinned ? -1 : 1
  if (sortBy === 'popular' && a.click_count !== b.click_count) return b.click_count - a.click_count
  if (sortBy === 'manual' && a.position !== b.position) return a.position - b.position
  const aTime = Date.parse(sortBy === 'updated' ? a.updated_at : a.created_at)
  const bTime = Date.parse(sortBy === 'updated' ? b.updated_at : b.created_at)
  return bTime - aTime
}

function toBookmark(bookmark: PublicBookmarkDTO): BookmarkDTO {
  return { ...bookmark, user_id: 'public', deleted_at: null, is_private: false }
}

function toFolder(folder: PublicBookmarkFolderDTO): BookmarkFolderDTO {
  return { ...folder, user_id: 'public', deleted_at: null, children: folder.children?.map(toFolder) }
}

function cycleValue<T>(values: readonly T[], current: T): T {
  const index = values.indexOf(current)
  return values[(index + 1) % values.length]!
}

function PublicShareLoading({ t }: { t: TFunction }) {
  return <div className="flex h-full items-center justify-center text-sm text-muted-foreground">{t('public.loading')}</div>
}

function PublicShareError({ t }: { t: TFunction }) {
  return <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center"><h1 className="text-lg font-semibold">{t('public.errorTitle')}</h1><p className="text-sm text-muted-foreground">{t('public.errorDescription')}</p></div>
}
