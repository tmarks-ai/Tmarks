import { useState } from 'react'
import { cn } from '@/lib/utils'
import type { ReactNode } from 'react'
import { Archive, ArrowDownUp, CheckSquare, Pin, Search } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { TabGroupDTO, TabGroupItemStatusFilter } from '@tmarks/contracts'
import { PaginationFooter, type PaginationFooterProps } from '@/components/common/PaginationFooter'
import { StatusFilterSelect } from '@/components/common/StatusFilterSelect'
import { EmptyState } from '@/components/common/EmptyState'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from '@/components/ui/select'
import { Hint } from '@/components/ui/tooltip'
import { SORT_OPTIONS, type TabGroupSortOption } from '@/lib/constants/tab-groups'
import { WorkspaceDrawer } from '@/components/bookmarks/workspace/WorkspaceDrawer'
import { TabGroupsSkeletonGrid } from '@/components/tab-groups/grid/TabGroupsGrid'

interface TabGroupMobilePanel {
  key: string
  title: string
  icon?: ReactNode
  content: ReactNode
  side?: 'left' | 'right'
}

interface TabGroupWorkspaceLayoutProps {
  tabGroups: TabGroupDTO[]
  isLoading: boolean
  isError?: boolean
  onRetry?: () => void
  pagination?: PaginationFooterProps
  searchKeyword: string
  onSearchKeywordChange: (kw: string) => void
  sortBy: TabGroupSortOption
  onSortByChange: (next: TabGroupSortOption) => void
  statusFilter: TabGroupItemStatusFilter
  onStatusFilterChange: (next: TabGroupItemStatusFilter) => void
  extraActions?: ReactNode
  emptyAction?: ReactNode
  footerSlot?: ReactNode
  leftPanel?: ReactNode
  rightPanel?: ReactNode
  mobilePanels?: TabGroupMobilePanel[]
  children?: ReactNode
  i18nNs?: string
}

const sortKey: Record<TabGroupSortOption, string> = {
  created: 'byCreated',
  title: 'byTitle',
  count: 'byCount',
}

/** 标签页收纳工作区布局:三栏 workspace-shell/grid + 内联工具栏(搜索/排序/抽屉入口)+ body。 */
export function TabGroupWorkspaceLayout(props: TabGroupWorkspaceLayoutProps) {
  const { t } = useTranslation(props.i18nNs || 'tabGroups')
  const [openPanelKey, setOpenPanelKey] = useState<string | null>(null)
  const hasLeft = Boolean(props.leftPanel)
  const hasRight = Boolean(props.rightPanel)
  const panelMode = hasLeft && hasRight ? 'both' : hasLeft ? 'left' : hasRight ? 'right' : 'single'
  const asideClass = 'hidden h-full min-h-0 xl:block'
  const activePanel = (props.mobilePanels ?? []).find((p) => p.key === openPanelKey)

  return (
    <div className="workspace-shell flex flex-col overflow-hidden">
      <div className={cn(`workspace-grid workspace-grid--tab-groups workspace-grid--${panelMode}`)}>
        {hasLeft && <aside className={asideClass}>{props.leftPanel}</aside>}
        <main className="flex h-full min-h-0 flex-col overflow-hidden">
          <div className="w-full flex-shrink-0">
            <div className="workspace-toolbar-surface w-full rounded-2xl border border-border/60 bg-card/70 p-3 sm:p-4">
              <Toolbar {...props} t={t} activeKey={openPanelKey} onOpenPanel={setOpenPanelKey} />
            </div>
          </div>
          <div className="relative flex h-full min-h-0 w-full flex-1 flex-col">
            <div className="tmarks-scrollbar workspace-bookmark-scroll w-full flex-1 overflow-y-auto overscroll-contain pb-2">
              <div className="workspace-bookmark-content">
                <TabGroupBody {...props} t={t} />
              </div>
            </div>
            {props.pagination && !props.isLoading && (
              <div className="workspace-pagination-overlay">
                <PaginationFooter {...props.pagination} />
              </div>
            )}
          </div>
        </main>
        {hasRight && <aside className={asideClass}>{props.rightPanel}</aside>}
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

function Toolbar(props: TabGroupWorkspaceLayoutProps & {
  t: (key: string, opt?: Record<string, unknown>) => string
  activeKey: string | null
  onOpenPanel: (key: string | null) => void
}) {
  const panels = props.mobilePanels ?? []
  return (
    <div className="flex w-full items-center gap-2 sm:gap-3">
      <div className="relative min-w-0 flex-1">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          className="h-11 pl-9"
          placeholder={props.t('search.placeholder')}
          value={props.searchKeyword}
          onChange={(e) => props.onSearchKeywordChange(e.target.value)}
        />
      </div>
      <Select value={props.sortBy} onValueChange={(v) => props.onSortByChange(v as TabGroupSortOption)}>
        <SelectTrigger
          className="h-11 w-11 flex-shrink-0 rounded-xl sm:w-[5.5rem]"
          aria-label={props.t('sort.label')}
        >
          <ArrowDownUp className="h-4 w-4 sm:hidden" />
          <span className="hidden sm:block">{props.t('sort.label')}</span>
        </SelectTrigger>
        <SelectContent>
          {SORT_OPTIONS.map((opt) => (
            <SelectItem key={opt} value={opt}>
              {props.t(`sort.${sortKey[opt]}`)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <StatusFilterSelect
        value={props.statusFilter}
        allValue="all"
        onValueChange={props.onStatusFilterChange}
        options={[
          { value: 'todo', label: props.t('filter.todo'), icon: CheckSquare },
          { value: 'pinned', label: props.t('filter.pinned'), icon: Pin },
          { value: 'archived', label: props.t('filter.archived'), icon: Archive },
        ]}
        allLabel={props.t('filter.all')}
        ariaLabel={props.t('filter.label')}
      />
      {panels.map((panel) => (
        <Hint key={panel.key} label={panel.title}>
          <button
            type="button"
            onClick={() => props.onOpenPanel(panel.key === props.activeKey ? null : panel.key)}
            className={cn(`flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl border transition-all xl:hidden ${
              panel.key === props.activeKey
                ? 'border-primary/40 bg-primary/10 text-primary'
                : 'border-border bg-card text-foreground hover:bg-muted'
            }`)}
            aria-label={panel.title}
          >
            {panel.icon}
          </button>
        </Hint>
      ))}
      {props.extraActions && <div className="flex flex-shrink-0 items-center gap-1">{props.extraActions}</div>}
    </div>
  )
}

function TabGroupBody(props: TabGroupWorkspaceLayoutProps & {
  t: (key: string, opt?: Record<string, unknown>) => string
}) {
  if (props.isError) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <p className="mb-4 text-red-600 dark:text-red-400">{props.t('page.loadFailed')}</p>
        {props.onRetry && (
          <button
            onClick={props.onRetry}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            {props.t('page.retry')}
          </button>
        )}
      </div>
    )
  }
  if (props.isLoading && props.tabGroups.length === 0) {
    return <TabGroupsSkeletonGrid />
  }
  if (!props.isLoading && props.tabGroups.length === 0) {
    return (
      <EmptyState
        icon={Search}
        title={props.t('empty.title')}
        description={props.t('empty.description')}
        action={props.emptyAction}
      />
    )
  }
  return <>{props.children}</>
}
