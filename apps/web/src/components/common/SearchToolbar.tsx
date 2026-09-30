import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { Bookmark as BookmarkIcon, Search, Tag as TagIcon, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Hint } from '@/components/ui/tooltip'
import { SortIcon, ViewModeIcon } from '@/components/common/BookmarkIcons'
import type { SortOption, ViewMode } from '@/lib/constants/bookmarks'

export interface SearchToolbarDrawerAction {
  key: string
  label: string
  icon: ReactNode
  onClick: () => void
  badgeCount?: number
  active?: boolean
}

interface SearchToolbarProps {
  searchMode: 'bookmark' | 'tag'
  onSearchModeToggle: () => void
  searchKeyword: string
  onSearchKeywordChange: (keyword: string) => void
  sortBy: SortOption
  onSortByChange: () => void
  viewMode: ViewMode
  onViewModeChange: () => void
  filterControl?: ReactNode
  drawerActions?: SearchToolbarDrawerAction[]
  extraActions?: ReactNode
  i18nNs?: string
}

export function SearchToolbar(props: SearchToolbarProps) {
  const { t } = useTranslation(props.i18nNs || 'bookmarks')
  const sortLabel = t(`sort.${props.sortBy}`, props.sortBy)
  const viewLabel = t(`viewMode.${props.viewMode}`, props.viewMode)
  const toggleLabel = props.searchMode === 'bookmark'
    ? t('toolbar.switchToTagSearch')
    : t('toolbar.switchToBookmarkSearch')
  const placeholder = props.searchMode === 'bookmark' ? t('search.placeholder') : t('search.tagPlaceholder')
  const actions = props.drawerActions ?? []

  return (
    <>
      {/* 移动端两行布局 */}
      <div className="flex w-full flex-col gap-3 xl:hidden">
        <div className="flex w-full items-center gap-3">
          {actions.length > 0 && (
            <div className="flex flex-shrink-0 items-center gap-2">
              {actions.map((action) => (
                <DrawerButton key={action.key} action={action} />
              ))}
            </div>
          )}
          <SearchInput
            searchMode={props.searchMode}
            onSearchModeToggle={props.onSearchModeToggle}
            searchKeyword={props.searchKeyword}
            onSearchKeywordChange={props.onSearchKeywordChange}
            toggleLabel={toggleLabel}
            placeholder={placeholder}
            clearLabel={t('workspace.clearAll')}
          />
        </div>
        <div className="flex w-full items-center justify-center gap-1 sm:w-auto">
          {props.filterControl}
          <ToolButton title={sortLabel} onClick={props.onSortByChange} showLabel>
            <SortIcon sort={props.sortBy} />
          </ToolButton>
          <ToolButton title={viewLabel} onClick={props.onViewModeChange} showLabel>
            <ViewModeIcon mode={props.viewMode} />
          </ToolButton>
          {props.extraActions}
        </div>
      </div>

      {/* 桌面端单行布局 */}
      <div className="hidden w-full items-center gap-3 xl:flex">
        <SearchInput
          searchMode={props.searchMode}
          onSearchModeToggle={props.onSearchModeToggle}
          searchKeyword={props.searchKeyword}
          onSearchKeywordChange={props.onSearchKeywordChange}
          toggleLabel={toggleLabel}
          placeholder={placeholder}
          clearLabel={t('workspace.clearAll')}
        />
        <div className="flex flex-shrink-0 items-center gap-4">
          {props.filterControl}
          <ToolButton title={sortLabel} onClick={props.onSortByChange}>
            <SortIcon sort={props.sortBy} />
          </ToolButton>
          <ToolButton title={viewLabel} onClick={props.onViewModeChange}>
            <ViewModeIcon mode={props.viewMode} />
          </ToolButton>
          {props.extraActions}
        </div>
      </div>
    </>
  )
}

function DrawerButton({ action }: { action: SearchToolbarDrawerAction }) {
  return (
    <Hint label={action.label}>
      <button
        type="button"
        onClick={action.onClick}
        aria-label={action.label}
        className={cn(`relative flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl border transition-all ${
          action.active
            ? 'border-primary/40 bg-primary/10 text-primary'
            : 'border-border bg-card text-foreground hover:bg-muted'
        }`)}
      >
        {action.icon}
        {!!action.badgeCount && (
          <span className="absolute -right-1 -top-1 min-w-5 rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-bold leading-none text-primary-foreground">
            {action.badgeCount}
          </span>
        )}
      </button>
    </Hint>
  )
}

function SearchInput({
  searchMode,
  onSearchModeToggle,
  searchKeyword,
  onSearchKeywordChange,
  toggleLabel,
  placeholder,
  clearLabel,
}: {
  searchMode: 'bookmark' | 'tag'
  onSearchModeToggle: () => void
  searchKeyword: string
  onSearchKeywordChange: (value: string) => void
  toggleLabel: string
  placeholder: string
  clearLabel: string
}) {
  return (
    <div className="min-w-0 flex-1">
      <div className="relative w-full">
        <button
          type="button"
          onClick={onSearchModeToggle}
          title={toggleLabel}
          aria-label={toggleLabel}
          className="absolute left-3 top-1/2 z-10 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-md transition-colors hover:bg-muted hover:text-primary"
        >
          {searchMode === 'bookmark' ? <BookmarkIcon className="h-5 w-5" /> : <TagIcon className="h-5 w-5" />}
        </button>
        <Search className="pointer-events-none absolute left-10 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground sm:left-12 sm:h-5 sm:w-5" />
        <input
          type="text"
          className="h-11 w-full rounded-md border border-input bg-background pl-14 pr-9 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:pl-[4.5rem]"
          placeholder={placeholder}
          aria-label={placeholder}
          value={searchKeyword}
          onChange={(e) => onSearchKeywordChange(e.target.value)}
        />
        {searchKeyword && (
          <button
            type="button"
            onClick={() => onSearchKeywordChange('')}
            aria-label={clearLabel}
            className="absolute right-2 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    </div>
  )
}

function ToolButton({
  title,
  onClick,
  active = false,
  showLabel = false,
  children,
}: {
  title: string
  onClick: () => void
  active?: boolean
  showLabel?: boolean
  children: ReactNode
}) {
  return (
    <Hint label={title}>
      <button
        type="button"
        onClick={onClick}
        aria-label={title}
        aria-pressed={active}
        className={cn(`inline-flex h-11 flex-shrink-0 items-center justify-center gap-2 rounded-xl text-foreground transition-colors hover:bg-muted ${
          showLabel ? 'w-auto px-3' : 'w-11'
        } ${
          active ? 'bg-muted text-primary' : ''
        }`)}
      >
        {children}
        {showLabel && <span className="hidden max-w-36 truncate text-xs font-medium 2xl:inline">{title}</span>}
      </button>
    </Hint>
  )
}
