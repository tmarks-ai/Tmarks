import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { DndContext, DragOverlay } from '@dnd-kit/core'
import type { TabGroupDTO, TabGroupItemDTO } from '@tmarks/contracts'
import {
  useAddTabGroupItems,
  useDeleteTabGroup,
  useDeleteTabGroupItem,
  useMoveTabGroupItem,
  useTabGroupDetailQuery,
  useTabGroups,
  useUpdateTabGroup,
  useUpdateTabGroupItem,
} from '@/hooks/useTabGroups'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'
import { useToastStore } from '@/stores/toastStore'
import { TabGroupHeader } from '@/components/tab-groups/grid/TabGroupHeader'
import { TabItemList } from '@/components/tab-groups/grid/TabItemList'
import { useItemDragAndDrop } from '@/components/tab-groups/grid/useItemDragAndDrop'
import { useTabGroupsState } from './hooks/useTabGroupsState'
import { TabGroupsDialogs } from './TabGroupsDialogs'
import { OpenAllTabsDialog } from '@/components/tab-groups/OpenAllTabsDialog'

/** 标签页组详情页:聚焦单个组的全量条目视图,复用详情查询 + 组内条目拖拽排序 + 全套对话框(与收纳页一致),标题可深链分享。 */
export function TabGroupDetailPage() {
  const { t } = useTranslation('tabGroups')
  const { id = '' } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { data: group, isLoading, isError, refetch } = useTabGroupDetailQuery(id)
  // 组名到货前先落站点级标题,到货后随查询更新(其余路由页同款)。
  useDocumentTitle(group?.title || t('pageTitle'))
  const { data: allGroups = [] } = useTabGroups()
  const state = useTabGroupsState()
  const { dialog } = state
  const [openAll, setOpenAll] = useState(false)
  const [showArchived, setShowArchived] = useState(false)
  const toast = useToastStore.getState()

  const updateGroup = useUpdateTabGroup()
  const deleteGroup = useDeleteTabGroup()
  const addItems = useAddTabGroupItems()
  const updateItem = useUpdateTabGroupItem()
  const deleteItem = useDeleteTabGroupItem()
  const moveItem = useMoveTabGroupItem()

  const handleRename = (title: string) => {
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
    deleteGroup.mutate(dialog.group.id, { onSuccess: () => { toast.success(t('message.deleteSuccess')); state.closeDialog(); navigate('/tab') } })
  }
  const handleDeleteItem = () => {
    if (dialog?.type !== 'confirmDeleteItem') return
    deleteItem.mutate(dialog.item.id, { onSuccess: () => { toast.success(t('message.deleteSuccess')); state.closeDialog() } })
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
  const handleToggleLock = (g: TabGroupDTO) =>
    updateGroup.mutate({ id: g.id, data: { is_locked: !g.is_locked } }, { onSuccess: () => toast.success(t(g.is_locked ? 'message.unlockSuccess' : 'message.lockSuccess')) })
  const handleOpenAll = (g: TabGroupDTO) =>
    (g.items || []).length === 0 ? toast.info(t('message.noTabsToOpen')) : setOpenAll(true)
  const handleTogglePin = (item: TabGroupItemDTO) =>
    updateItem.mutate({ itemId: item.id, data: { is_pinned: !item.is_pinned } }, { onSuccess: () => toast.success(t(item.is_pinned ? 'message.unpinSuccess' : 'message.pinSuccess')) })
  const handleToggleTodo = (item: TabGroupItemDTO) =>
    updateItem.mutate({ itemId: item.id, data: { is_todo: !item.is_todo } }, { onSuccess: () => toast.success(t(item.is_todo ? 'message.untodoSuccess' : 'message.todoSuccess')) })
  const handleToggleArchive = (item: TabGroupItemDTO) =>
    updateItem.mutate({ itemId: item.id, data: { is_archived: !item.is_archived } }, { onSuccess: () => toast.success(t(item.is_archived ? 'message.unarchiveSuccess' : 'message.archiveSuccess')) })
  const handleItemDragMove = (itemId: string, targetGroupId: string, position: number) =>
    moveItem.mutate({ itemId, data: { target_group_id: targetGroupId, position } })

  const itemDnd = useItemDragAndDrop({ tabGroups: group ? [group] : [], onMoveItem: handleItemDragMove })

  if (isLoading) {
    return <div className="flex h-full items-center justify-center text-sm text-muted-foreground">{t('page.loading')}</div>
  }
  if (isError) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-sm text-muted-foreground">
        <p>{t('detail.loadFailed')}</p>
        <Button variant="outline" onClick={() => refetch()}>{t('detail.retry')}</Button>
      </div>
    )
  }
  if (!group) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-sm text-muted-foreground">
        <p>{t('detail.groupNotFound')}</p>
        <Button variant="outline" onClick={() => navigate('/tab')}>{t('detail.backToList')}</Button>
      </div>
    )
  }

  return (
    <>

      <h1 className="sr-only">{t('pageTitle')}</h1>      <div className="tmarks-scrollbar h-full overflow-y-auto">
        <div className="mx-auto w-full max-w-3xl px-4 py-6">
          <button
            type="button"
            onClick={() => navigate('/tab')}
            className="mb-4 flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" />
            {t('detail.backToList')}
          </button>
          <article className="rounded-2xl border border-border/60 bg-card shadow-sm">
            <TabGroupHeader
              group={group}
              onEdit={state.openRenameGroup}
              onDelete={state.openDeleteGroup}
              onAddItems={state.openAddItems}
              onOpenAll={handleOpenAll}
              onMoveGroup={state.openMoveGroup}
              onColorTag={state.openColorTag}
              onToggleLock={handleToggleLock}
              onDedup={state.openDedup}
            />
            <div className="flex items-center gap-2 px-2 py-1.5">
              <Switch checked={showArchived} onCheckedChange={setShowArchived} id="show-archived" />
              <label htmlFor="show-archived" className="text-xs text-muted-foreground">{t('detail.showArchived')}</label>
            </div>
            <div className="p-2">
              <DndContext {...itemDnd.dndContextProps}>
                <TabItemList
                  items={(group.items || []).filter((i) => showArchived || !i.is_archived)}
                  groupId={group.id}
                  groupLocked={!!group.is_locked}
                  onEditItem={state.openEditItem}
                  onDeleteItem={state.openDeleteItem}
                  onTogglePin={handleTogglePin}
                  onToggleTodo={handleToggleTodo}
                  onToggleArchive={handleToggleArchive}
                  onMoveItem={state.openMoveItem}
                  overId={itemDnd.overId}
                  dropPosition={itemDnd.dropPosition}
                />
                <DragOverlay>
                  {itemDnd.activeItem ? (
                    <div className="rounded-lg border border-border bg-card px-3 py-2 shadow-lg">
                      <span className="text-sm font-medium text-foreground">{itemDnd.activeItem.title}</span>
                    </div>
                  ) : null}
                </DragOverlay>
              </DndContext>
            </div>
          </article>
        </div>
      </div>

      <OpenAllTabsDialog group={openAll ? group : null} onClose={() => setOpenAll(false)} />

      <TabGroupsDialogs
        dialog={dialog}
        allGroups={allGroups}
        isCreating={false}
        isUpdating={updateGroup.isPending}
        isAddingItems={addItems.isPending}
        isUpdatingItem={updateItem.isPending}
        isDeletingGroup={deleteGroup.isPending}
        isDeletingItem={deleteItem.isPending}
        isMovingItem={moveItem.isPending}
        onCreateGroup={() => {}}
        onRenameGroup={handleRename}
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
