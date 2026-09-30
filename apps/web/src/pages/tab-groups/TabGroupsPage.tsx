import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CheckSquare, Layers, Plus } from 'lucide-react'
import { DndContext, DragOverlay } from '@dnd-kit/core'
import type { TabGroupDTO, TabGroupItemDTO } from '@tmarks/contracts'
import { buildGroupsByParent, collectDescendantGroups } from '@/lib/tab-group-hierarchy'
import {
  useAddTabGroupItems,
  useCreateTabGroup,
  useDeleteTabGroup,
  useDeleteTabGroupItem,
  useTabGroups,
  useUpdateTabGroup,
  useUpdateTabGroupItem,
  useMoveTabGroupItem,
  useBatchUpdatePositions,
} from '@/hooks/useTabGroups'
import { useToastStore } from '@/stores/toastStore'
import { useTabGroupsData } from './hooks/useTabGroupsData'
import { useTabGroupsState } from './hooks/useTabGroupsState'
import { useTabGroupsPagination } from './hooks/useTabGroupsPagination'
import { useTabGroupsBatch } from './hooks/useTabGroupsBatch'
import { usePreferences, useUpdatePreferences } from '@/hooks/usePreferences'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'
import { getPageSize } from '@/lib/constants/bookmarks'
import { Button } from '@/components/ui/button'
import { Hint } from '@/components/ui/tooltip'
import { BatchActionBar } from '@/components/tab-groups/BatchActionBar'
import { TabGroupsGrid } from '@/components/tab-groups/grid/TabGroupsGrid'
import { useItemDragAndDrop } from '@/components/tab-groups/grid/useItemDragAndDrop'
import { TabGroupTree } from '@/components/tab-groups/tree/TabGroupTree'
import { TabGroupWorkspaceLayout } from '@/components/tab-groups/workspace/TabGroupWorkspaceLayout'
import { TabGroupsDialogs } from './TabGroupsDialogs'
import { OpenAllTabsDialog } from '@/components/tab-groups/OpenAllTabsDialog'

/** 标签页收纳页:三栏布局(树/网格)+ 搜索排序 + 组与条目增删改查 + 对话框状态机 + 批量模式(固定/待办/导出/删除)。 */
export function TabGroupsPage() {
  const { t } = useTranslation('tabGroups')
  useDocumentTitle(t('pageTitle'))
  const { data: allGroups = [], isLoading, isError, refetch } = useTabGroups()
  const state = useTabGroupsState()
  const { visibleGroups, layoutMode, hasAnyGroups } = useTabGroupsData(
    allGroups, state.searchQuery, state.sortBy, state.selectedFolderId, state.statusFilter,
  )
  const { data: preferencesData } = usePreferences()
  const updatePrefs = useUpdatePreferences()
  const pageSize = getPageSize(preferencesData?.preferences.page_size)
  const { pagedGroups, pagination } = useTabGroupsPagination(visibleGroups, layoutMode, {
    pageSize,
    resetKey: `${state.searchQuery}|${state.sortBy}|${state.selectedFolderId ?? ''}|${state.statusFilter}`,
    onPageSizeChange: (size) => updatePrefs.mutate({ page_size: size }),
  })

  const createGroup = useCreateTabGroup()
  const updateGroup = useUpdateTabGroup()
  const deleteGroup = useDeleteTabGroup()
  const addItems = useAddTabGroupItems()
  const updateItem = useUpdateTabGroupItem()
  const deleteItem = useDeleteTabGroupItem()
  const moveItem = useMoveTabGroupItem()
  const batchPositions = useBatchUpdatePositions()
  const { dialog } = state
  const [openAllGroup, setOpenAllGroup] = useState<TabGroupDTO | null>(null)

  const allItemIds = pagedGroups.flatMap((g) => (g.items || []).map((i) => i.id))
  const toast = useToastStore.getState()
  const batch = useTabGroupsBatch({ allGroups, selectedIds: state.selectedIds, onClearSelection: state.clearSelection })

  useEffect(() => {
    state.clearSelection()
  }, [allGroups, state.searchQuery, state.sortBy, state.selectedFolderId, state.statusFilter])

  const handleCreateGroup = (title: string) => {
    if (dialog?.type !== 'createGroup') return
    createGroup.mutate(
      { title, parent_id: dialog.parentId, is_folder: dialog.isFolder },
      { onSuccess: () => { toast.success(t('message.createSuccess')); state.closeDialog() } },
    )
  }
  const handleRenameGroup = (title: string) => {
    if (dialog?.type !== 'renameGroup') return
    updateGroup.mutate({ id: dialog.group.id, data: { title } }, { onSuccess: () => { toast.success(t('message.renameSuccess')); state.closeDialog() } })
  }
  const handleAddItems = (data: { title: string; url: string }) => {
    if (dialog?.type !== 'addItems') return
    addItems.mutate(
      { groupId: dialog.group.id, items: [{ title: data.title, url: data.url }] },
      { onSuccess: () => { toast.success(t('message.addItemsSuccess')); state.closeDialog() } },
    )
  }
  const handleEditItem = (title: string) => {
    if (dialog?.type !== 'editItem') return
    updateItem.mutate({ itemId: dialog.item.id, data: { title } }, { onSuccess: () => { toast.success(t('message.editItemSuccess')); state.closeDialog() } })
  }
  const handleDeleteGroup = () => {
    if (dialog?.type !== 'confirmDeleteGroup') return
    const target = dialog.group
    deleteGroup.mutate(target.id, {
      onSuccess: () => {
        // 选中目录(或其后代)被删时回退"全部":后端级联软删整棵子树,
        // 留着失效选中会让主面板静默空白(书签页同修,见 BookmarkFolderPanel)。
        const descendantIds = collectDescendantGroups(target.id, buildGroupsByParent(allGroups)).map((g) => g.id)
        if (state.selectedFolderId && (target.id === state.selectedFolderId || descendantIds.includes(state.selectedFolderId))) {
          state.setSelectedFolderId(null)
        }
        toast.success(t('message.deleteSuccess')); state.closeDialog()
      },
    })
  }
  const handleDeleteItem = () => {
    if (dialog?.type !== 'confirmDeleteItem') return
    deleteItem.mutate(dialog.item.id, { onSuccess: () => { toast.success(t('message.deleteSuccess')); state.closeDialog() } })
  }
  const handleOpenAll = (group: TabGroupDTO) => {
    if ((group.items || []).length === 0) {
      toast.info(t('message.noTabsToOpen'))
      return
    }
    setOpenAllGroup(group)
  }
  const handleTogglePin = (item: TabGroupItemDTO) => {
    updateItem.mutate({ itemId: item.id, data: { is_pinned: !item.is_pinned } }, { onSuccess: () => toast.success(t(item.is_pinned ? 'message.unpinSuccess' : 'message.pinSuccess')) })
  }
  const handleToggleTodo = (item: TabGroupItemDTO) => {
    updateItem.mutate({ itemId: item.id, data: { is_todo: !item.is_todo } }, { onSuccess: () => toast.success(t(item.is_todo ? 'message.untodoSuccess' : 'message.todoSuccess')) })
  }
  const handleToggleArchive = (item: TabGroupItemDTO) => {
    updateItem.mutate({ itemId: item.id, data: { is_archived: !item.is_archived } }, { onSuccess: () => toast.success(t(item.is_archived ? 'message.unarchiveSuccess' : 'message.archiveSuccess')) })
  }
  const handleMoveGroup = (targetParentId: string | null) => {
    if (dialog?.type !== 'moveGroup') return
    // 只发 parent_id 时后端原样保留旧 position(多为 0),与目标父级既有
    // 子项撞序、落位漂移——补发目标父级末尾位置。
    const siblings = allGroups.filter((g) => (g.parent_id ?? null) === targetParentId && g.id !== dialog.group.id)
    const nextPosition = siblings.length > 0 ? Math.max(...siblings.map((g) => g.position)) + 1 : 0
    updateGroup.mutate({ id: dialog.group.id, data: { parent_id: targetParentId, position: nextPosition } }, { onSuccess: () => { toast.success(t('message.moveSuccess')); state.closeDialog() } })
  }
  const handleMoveItem = (targetGroupId: string) => {
    if (dialog?.type !== 'moveItem') return
    moveItem.mutate({ itemId: dialog.item.id, data: { target_group_id: targetGroupId } }, { onSuccess: () => { toast.success(t('message.moveSuccess')); state.closeDialog() } })
  }
  const handleColorTag = (color: string | null, tags: string[]) => {
    if (dialog?.type !== 'colorTag') return
    updateGroup.mutate({ id: dialog.group.id, data: { color, tags } }, { onSuccess: () => { toast.success(t('message.colorTagSuccess')); state.closeDialog() } })
  }
  const handleToggleLock = (group: TabGroupDTO) =>
    updateGroup.mutate({ id: group.id, data: { is_locked: !group.is_locked } }, { onSuccess: () => toast.success(t(group.is_locked ? 'message.unlockSuccess' : 'message.lockSuccess')) })
  const handleTreeMove = (groupId: string, newParentId: string | null, newPosition: number) => {
    const dragged = allGroups.find((g) => g.id === groupId)
    if (!dragged) return
    // 与 useTreeDragAndDrop 同口径:按 position ASC 排序后再落点,
    // 否则 splice 用的是 created_at DESC 的接口序,重排全组错乱。
    const siblings = allGroups.filter((g) => (g.parent_id ?? null) === newParentId && g.id !== groupId).sort((a, b) => a.position - b.position)
    siblings.splice(newPosition, 0, dragged)
    batchPositions.mutate(siblings.map((g, i) => ({ id: g.id, position: i, parent_id: newParentId })), { onSuccess: () => toast.success(t('message.moveSuccess')) })
  }
  const handleItemDragMove = (itemId: string, targetGroupId: string, position: number) => {
    moveItem.mutate({ itemId, data: { target_group_id: targetGroupId, position } }, { onSuccess: () => toast.success(t('message.moveSuccess')) })
  }
  const itemDnd = useItemDragAndDrop({ tabGroups: allGroups, onMoveItem: handleItemDragMove })

  const tree = (
    <TabGroupTree
      groups={allGroups}
      selectedFolderId={state.selectedFolderId}
      onSelectFolder={state.setSelectedFolderId}
      onCreateFolder={() => state.openCreateFolder(null)}
      onRenameFolder={state.openRenameGroup}
      onDeleteFolder={state.openDeleteGroup}
      onMoveFolder={state.openMoveGroup}
      onColorTag={state.openColorTag}
      onToggleLock={handleToggleLock}
      onReorderGroup={handleTreeMove}
      onCreateSubfolder={(parentId) => state.openCreateFolder(parentId)}
    />
  )

  return (
    <>

      <h1 className="sr-only">{t('pageTitle')}</h1>      <TabGroupWorkspaceLayout
        tabGroups={allGroups}
        isLoading={isLoading}
        isError={isError}
        onRetry={() => refetch()}
        pagination={pagination}
        searchKeyword={state.searchQuery}
        onSearchKeywordChange={state.setSearchQuery}
        sortBy={state.sortBy}
        onSortByChange={state.setSortBy}
        statusFilter={state.statusFilter}
        onStatusFilterChange={state.setStatusFilter}
        extraActions={(
          <>
            <Hint label={t('action.create')}>
              <Button size="icon" className="h-10 w-10 sm:h-11 sm:w-11" onClick={() => state.openCreateGroup(null)} aria-label={t('action.create')}>
                <Plus />
              </Button>
            </Hint>
            <Hint label={state.batchMode ? t('batch.exit') : t('batch.enter')}>
              <Button variant={state.batchMode ? 'secondary' : 'ghost'} size="icon" className="h-10 w-10 sm:h-11 sm:w-11" onClick={state.toggleBatch} aria-label={state.batchMode ? t('batch.exit') : t('batch.enter')}>
                <CheckSquare />
              </Button>
            </Hint>
          </>
        )}
        emptyAction={(
          <Button onClick={() => state.openCreateGroup(null)} className="mt-6">
            {t('action.create')}
          </Button>
        )}
        leftPanel={tree}
        mobilePanels={[{ key: 'tree', title: t('sidebar.title'), icon: <Layers className="h-5 w-5" />, content: tree }]}
        footerSlot={state.batchMode ? (
          <BatchActionBar
            selectedCount={state.selectedIds.length}
            totalCount={allItemIds.length}
            isPending={batch.isPending}
            canPin={batch.canPin}
            canUnpin={batch.canUnpin}
            canTodo={batch.canTodo}
            canUntodo={batch.canUntodo}
            canArchive={batch.canArchive}
            canUnarchive={batch.canUnarchive}
            onSelectAll={() => state.selectAll(allItemIds)}
            onClearSelection={state.clearSelection}
            onPin={batch.onPin}
            onUnpin={batch.onUnpin}
            onTodo={batch.onTodo}
            onUntodo={batch.onUntodo}
            onArchive={batch.onArchive}
            onUnarchive={batch.onUnarchive}
            onExport={batch.onExport}
            onDelete={batch.onDelete}
          />
        ) : undefined}
      >
        <DndContext {...itemDnd.dndContextProps}>
          <TabGroupsGrid
            groups={pagedGroups}
            layoutMode={layoutMode}
            hasAnyGroups={hasAnyGroups}
            isLoading={isLoading}
            searchQuery={state.searchQuery}
            filteringByStatus={state.statusFilter !== 'all'}
            onClearStatusFilter={() => state.setStatusFilter('all')}
            onCreateGroup={() => state.openCreateGroup(null)}
            onEditGroup={state.openRenameGroup}
            onDeleteGroup={state.openDeleteGroup}
            onAddItems={state.openAddItems}
            onOpenAll={handleOpenAll}
            onEditItem={state.openEditItem}
            onDeleteItem={state.openDeleteItem}
            onTogglePin={handleTogglePin}
            onToggleTodo={handleToggleTodo}
            onToggleArchive={handleToggleArchive}
            onMoveGroup={state.openMoveGroup}
            onColorTag={state.openColorTag}
            onToggleLock={handleToggleLock}
            onDedup={state.openDedup}
            onMoveItem={state.openMoveItem}
            batchMode={state.batchMode}
            selectedIds={state.selectedIds}
            onToggleSelect={state.toggleSelect}
            overId={itemDnd.overId}
            dropPosition={itemDnd.dropPosition}
          />
          <DragOverlay>
            {itemDnd.activeItem ? <div className="rounded-lg border border-border bg-card px-3 py-2 shadow-lg"><span className="text-sm font-medium text-foreground">{itemDnd.activeItem.title}</span></div> : null}
          </DragOverlay>
        </DndContext>
      </TabGroupWorkspaceLayout>

      <OpenAllTabsDialog group={openAllGroup} onClose={() => setOpenAllGroup(null)} />

      <TabGroupsDialogs
        dialog={dialog}
        allGroups={allGroups}
        isCreating={createGroup.isPending}
        isUpdating={updateGroup.isPending}
        isAddingItems={addItems.isPending}
        isUpdatingItem={updateItem.isPending}
        isDeletingGroup={deleteGroup.isPending}
        isDeletingItem={deleteItem.isPending}
        isMovingItem={moveItem.isPending}
        onCreateGroup={handleCreateGroup}
        onRenameGroup={handleRenameGroup}
        onAddItems={handleAddItems}
        onEditItem={handleEditItem}
        onDeleteGroup={handleDeleteGroup}
        onDeleteItem={handleDeleteItem}
        onMoveGroup={handleMoveGroup}
        onMoveItem={handleMoveItem}
        onColorTag={handleColorTag}
        onCancel={state.closeDialog}
      />
    </>
  )
}
