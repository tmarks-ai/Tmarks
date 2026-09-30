import { Folder } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { TabGroupDTO, TabGroupItemDTO } from '@tmarks/contracts'
import {
  buildGroupsByParent,
  collectContentGroups,
  countGroupItems,
  isContentGroup,
} from '@/lib/tab-group-hierarchy'
import { MasonryGrid } from '@/components/common/MasonryGrid'
import { EmptyState } from '../EmptyState'
import { PinnedItemsSection } from '../PinnedItemsSection'
import { TabGroupHeader } from './TabGroupHeader'
import { TabItemList } from './TabItemList'
import type { ItemDropPosition } from './useItemDragAndDrop'

interface TabGroupsGridProps {
  groups: TabGroupDTO[]
  layoutMode: 'root' | 'flat'
  hasAnyGroups: boolean
  isLoading?: boolean
  searchQuery: string
  filteringByStatus?: boolean
  onCreateGroup?: () => void
  onEditGroup: (group: TabGroupDTO) => void
  onDeleteGroup: (group: TabGroupDTO) => void
  onAddItems: (group: TabGroupDTO) => void
  onOpenAll: (group: TabGroupDTO) => void
  onEditItem: (item: TabGroupItemDTO) => void
  onDeleteItem: (item: TabGroupItemDTO) => void
  onTogglePin?: (item: TabGroupItemDTO) => void
  onToggleTodo?: (item: TabGroupItemDTO) => void
  onToggleArchive?: (item: TabGroupItemDTO) => void
  onMoveGroup?: (group: TabGroupDTO) => void
  onColorTag?: (group: TabGroupDTO) => void
  onToggleLock?: (group: TabGroupDTO) => void
  onDedup?: (group: TabGroupDTO) => void
  onMoveItem?: (item: TabGroupItemDTO) => void
  onClearStatusFilter?: () => void
  batchMode?: boolean
  selectedIds?: string[]
  onToggleSelect?: (id: string) => void
  overId?: string | null
  dropPosition?: ItemDropPosition | null
  i18nNs?: string
}

/** 标签页组加载骨架(初始加载无数据时,代替 EmptyState)。 */
export function TabGroupsSkeletonGrid({ count = 5 }: { count?: number }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="animate-pulse rounded-2xl border border-border/60 bg-card p-3 shadow-sm">
          <div className="mb-2.5 h-4 w-1/3 rounded bg-muted" />
          <div className="space-y-2 pt-1">
            <div className="h-8 rounded bg-muted" />
            <div className="h-8 rounded bg-muted" />
            <div className="h-8 rounded bg-muted" />
          </div>
        </div>
      ))}
    </div>
  )
}

/** 标签页组网格:根视图按文件夹分组(buildGroupsByParent + collectContentGroups),文件夹/搜索视图平铺 content groups。批量模式下隐藏置顶区(选择仅针对组内条目)。 */
export function TabGroupsGrid(props: TabGroupsGridProps) {
  const { t } = useTranslation(props.i18nNs || 'tabGroups')

  const renderCard = (group: TabGroupDTO) => (
    <article key={group.id} className="rounded-2xl border border-border/60 bg-card shadow-sm">
      <TabGroupHeader
        group={group}
        onEdit={props.onEditGroup}
        onDelete={props.onDeleteGroup}
        onAddItems={props.onAddItems}
        onOpenAll={props.onOpenAll}
        onMoveGroup={props.onMoveGroup}
        onColorTag={props.onColorTag}
        onToggleLock={props.onToggleLock}
        onDedup={props.onDedup}
        i18nNs={props.i18nNs}
      />
      <div className="p-2">
        <TabItemList
          items={group.items || []}
          groupId={group.id}
          groupLocked={!!group.is_locked}
          onEditItem={props.onEditItem}
          onDeleteItem={props.onDeleteItem}
          onTogglePin={props.onTogglePin}
          onToggleTodo={props.onToggleTodo}
          onToggleArchive={props.onToggleArchive}
          onMoveItem={props.onMoveItem}
          batchMode={props.batchMode}
          selectedIds={props.selectedIds}
          onToggleSelect={props.onToggleSelect}
          overId={props.overId}
          dropPosition={props.dropPosition}
          i18nNs={props.i18nNs}
        />
      </div>
    </article>
  )

  const filtering = Boolean(props.filteringByStatus)
  const showPinned = !props.searchQuery.trim() && !props.batchMode && !filtering
  const pinnedSection = showPinned ? (
    <PinnedItemsSection tabGroups={props.groups} onUnpin={props.onTogglePin} i18nNs={props.i18nNs} />
  ) : null

  if (!props.hasAnyGroups) {
    if (props.isLoading) return <TabGroupsSkeletonGrid />
    return <EmptyState isSearching={false} onCreateGroup={props.onCreateGroup} i18nNs={props.i18nNs} />
  }
  if (props.groups.length === 0) {
    return (
      <EmptyState
        isSearching={Boolean(props.searchQuery.trim())}
        searchQuery={props.searchQuery}
        isFiltering={filtering}
        onClearFilter={props.onClearStatusFilter}
        onCreateGroup={props.onCreateGroup}
        i18nNs={props.i18nNs}
      />
    )
  }

  if (props.layoutMode === 'flat') {
    const contentGroups = props.groups.filter(isContentGroup)
    if (contentGroups.length === 0) {
      return (
        <EmptyState
          isSearching={Boolean(props.searchQuery.trim())}
          searchQuery={props.searchQuery}
          isFiltering={filtering}
          onClearFilter={props.onClearStatusFilter}
          onCreateGroup={props.onCreateGroup}
          i18nNs={props.i18nNs}
        />
      )
    }
    return (
      <>
        {pinnedSection}
        <MasonryGrid minColumnWidth={260} gap={12} maxCols={3}>
          {contentGroups.map(renderCard)}
        </MasonryGrid>
      </>
    )
  }

  const groupsByParent = buildGroupsByParent(props.groups)
  const rootGroups = groupsByParent.get(null) || []
  const rootContent = rootGroups.filter((g) => !g.is_folder)
  const rootFolders = rootGroups.filter((g) => g.is_folder)
  const hasVisibleContent = rootContent.length > 0 || rootFolders.some((folder) => collectContentGroups(folder, groupsByParent).length > 0)

  if (!hasVisibleContent) {
    return <EmptyState isSearching={false} onCreateGroup={props.onCreateGroup} i18nNs={props.i18nNs} />
  }

  return (
    <>
      {pinnedSection}
      {rootContent.length > 0 && (
        <MasonryGrid minColumnWidth={260} gap={12} maxCols={3}>
          {rootContent.map(renderCard)}
        </MasonryGrid>
      )}
      <div className="space-y-6">
        {rootFolders.map((folder) => {
          const children = collectContentGroups(folder, groupsByParent)
          if (children.length === 0) return null
          return (
            <section key={folder.id}>
              <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
                <Folder className="h-4 w-4 text-primary" />
                <span>{folder.title}</span>
                <span className="text-xs font-normal text-muted-foreground">
                  {t('header.tabCount', { count: countGroupItems(children) })}
                </span>
              </h2>
              <MasonryGrid minColumnWidth={260} gap={12} maxCols={3}>
                {children.map(renderCard)}
              </MasonryGrid>
            </section>
          )
        })}
      </div>
    </>
  )
}
