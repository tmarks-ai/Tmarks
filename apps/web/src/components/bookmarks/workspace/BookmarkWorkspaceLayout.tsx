import { useState } from 'react'
import { cn } from '@/lib/utils'
import type { ReactNode } from 'react'
import { FilterX, Search } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { BookmarkDTO, ReorderBookmarkItem } from '@tmarks/contracts'
import { BookmarkListContainer } from '@/components/bookmarks/BookmarkListContainer'
import { EmptyState } from '@/components/common/EmptyState'
import { Button } from '@/components/ui/button'
import {
  PaginationFooter,
  type PaginationFooterProps,
} from '@/components/common/PaginationFooter'
import {
  SearchToolbar,
  type SearchToolbarDrawerAction,
} from '@/components/common/SearchToolbar'
import type { SortOption, ViewMode } from '@/lib/constants/bookmarks'
import { WorkspaceDrawer } from './WorkspaceDrawer'

interface WorkspaceMobilePanel {
  key: string
  title: string
  icon: ReactNode
  content: ReactNode
  badgeCount?: number
  side?: 'left' | 'right'
}

interface BookmarkWorkspaceLayoutProps {
  bookmarks: BookmarkDTO[]
  isLoading: boolean
  isError?: boolean
  onRetry?: () => void
  pagination?: PaginationFooterProps
  searchMode: 'bookmark' | 'tag'
  onSearchModeToggle: () => void
  searchKeyword: string
  onSearchKeywordChange: (kw: string) => void
  sortBy: SortOption
  onSortByChange: () => void
  viewMode: ViewMode
  onViewModeChange: () => void
  /** 卡片网格密度(外观设置):紧凑/标准/宽松。 */
  density?: 'compact' | 'normal' | 'comfortable' 
  navigationMode?: 'folders' | 'tags'
  readOnly?: boolean
  batchMode?: boolean
  selectedIds?: string[]
  onToggleSelect?: (id: string) => void
  onEdit?: (bookmark: BookmarkDTO) => void
  onTogglePin?: (bookmark: BookmarkDTO) => void
  onToggleTodo?: (bookmark: BookmarkDTO) => void
  onToggleArchive?: (bookmark: BookmarkDTO) => void
  onMove?: (bookmark: BookmarkDTO) => void
  sortable?: boolean
  onReorder?: (updates: ReorderBookmarkItem[]) => void
  extraActions?: ReactNode
  filterControl?: ReactNode
  footerSlot?: ReactNode
  pinnedSlot?: ReactNode
  leftPanel?: ReactNode
  rightPanel?: ReactNode
  mobilePanels?: WorkspaceMobilePanel[]
  i18nNs?: string
  isFiltering?: boolean
  onClearFilters?: () => void
}

/** 书签工作区三栏布局:workspace-shell 自适应高度 + workspace-grid 响应式三栏 +
 * workspace-toolbar-surface 阴影 + workspace-bookmark-scroll 顶部 fade + workspace-pagination-overlay 浮动胶囊分页。 */
export function BookmarkWorkspaceLayout(props: BookmarkWorkspaceLayoutProps) {
  const [openPanelKey, setOpenPanelKey] = useState<string | null>(null)
  const hasLeft = Boolean(props.leftPanel)
  const hasRight = Boolean(props.rightPanel)
  const panelMode = hasLeft && hasRight ? 'both' : hasLeft ? 'left' : hasRight ? 'right' : 'single'
  const primaryClass = hasLeft && hasRight ? ` workspace-grid--primary-${props.navigationMode ?? 'folders'}` : ''
  const panels = props.mobilePanels ?? []
  const activePanel = panels.find((panel) => panel.key === openPanelKey)
  const drawerActions: SearchToolbarDrawerAction[] = panels.map((panel) => ({
    key: panel.key,
    label: panel.title,
    icon: panel.icon,
    badgeCount: panel.badgeCount,
    active: panel.key === openPanelKey,
    onClick: () => setOpenPanelKey(panel.key),
  }))
  const pagination = props.isLoading ? undefined : props.pagination

  return (
    <div className="workspace-shell flex flex-col overflow-hidden">
      <div className={cn(`workspace-grid workspace-grid--${panelMode}${primaryClass}`)}>
        {hasLeft && (
          <aside className="hidden h-full min-h-0 xl:block">
            {props.leftPanel}
          </aside>
        )}

        <main className="flex h-full min-h-0 flex-col overflow-hidden">
          <div className="w-full flex-shrink-0">
            <div className="workspace-toolbar-surface w-full rounded-2xl border border-border/60 bg-card/70 p-3 sm:p-4">
              <SearchToolbar
                searchMode={props.searchMode}
                onSearchModeToggle={props.onSearchModeToggle}
                searchKeyword={props.searchKeyword}
                onSearchKeywordChange={props.onSearchKeywordChange}
                sortBy={props.sortBy}
                onSortByChange={props.onSortByChange}
                viewMode={props.viewMode}
                onViewModeChange={props.onViewModeChange}
                filterControl={props.filterControl}
                drawerActions={drawerActions}
                extraActions={props.extraActions}
                i18nNs={props.i18nNs}
              />
            </div>
          </div>

          <div className="relative flex w-full min-h-0 flex-1 flex-col">
            <div className="tmarks-scrollbar workspace-bookmark-scroll w-full flex-1 overflow-y-auto overscroll-contain pb-2">
              <div className="workspace-bookmark-content">
                <BookmarkBody {...props} />
              </div>
            </div>
            {pagination && (
              <div className="workspace-pagination-overlay">
                <PaginationFooter {...pagination} />
              </div>
            )}
          </div>
        </main>

        {hasRight && (
          <aside className="hidden h-full min-h-0 xl:block">
            {props.rightPanel}
          </aside>
        )}
      </div>

      {activePanel && (
        <WorkspaceDrawer
          isOpen
          title={activePanel.title}
          side={activePanel.side}
          onClose={() => setOpenPanelKey(null)}
        >
          {activePanel.content}
        </WorkspaceDrawer>
      )}
      {props.footerSlot && (
        <div className="relative z-20 flex-shrink-0">
          {props.footerSlot}
        </div>
      )}
    </div>
  )
}

function BookmarkBody(props: BookmarkWorkspaceLayoutProps) {
  const { t } = useTranslation(props.i18nNs || 'bookmarks')
  if (props.isError) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <p className="mb-4 text-red-600 dark:text-red-400">{t('error')}</p>
        {props.onRetry && (
          <button
            type="button"
            onClick={props.onRetry}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            {t('retry')}
          </button>
        )}
      </div>
    )
  }

  if (!props.isLoading && props.bookmarks.length === 0 && !props.pinnedSlot) {
    const showClearFilters = Boolean(props.isFiltering && props.onClearFilters)
    return (
      <EmptyState
        icon={showClearFilters ? FilterX : Search}
        title={showClearFilters ? t('search.noResults') : t('empty.title')}
        description={showClearFilters ? undefined : t('empty.hint')}
        className="card rounded-xl border border-border/60 bg-card/95"
        action={
          showClearFilters ? (
            <Button variant="outline" size="sm" onClick={props.onClearFilters}>
              {t('batch.emptyFilteredAction')}
            </Button>
          ) : undefined
        }
      />
    )
  }

  return (
    <>
      {props.pinnedSlot}
      {(props.bookmarks.length > 0 || !props.pinnedSlot) && (
        <BookmarkListContainer
          bookmarks={props.bookmarks}
          viewMode={props.viewMode}
          density={props.density}
          onEdit={props.readOnly ? undefined : props.onEdit}
          isLoading={props.isLoading}
          readOnly={props.readOnly}
          batchMode={props.batchMode}
          selectedIds={props.selectedIds}
          onToggleSelect={props.onToggleSelect}
          onTogglePin={props.readOnly ? undefined : props.onTogglePin}
          onToggleTodo={props.readOnly ? undefined : props.onToggleTodo}
          onToggleArchive={props.readOnly ? undefined : props.onToggleArchive}
          onMove={props.readOnly ? undefined : props.onMove}
          sortable={props.sortable && !props.readOnly}
          onReorder={props.onReorder}
          isFiltering={props.isFiltering}
          onClearFilters={props.onClearFilters}
        />
      )}
    </>
  )
}
