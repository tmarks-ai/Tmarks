import { useTranslation } from 'react-i18next'
import type { TabGroupDTO } from '@tmarks/contracts'
import type { TabGroupDialog } from './hooks/useTabGroupsState'
import { ConfirmDialog } from '@/components/common/ConfirmDialog'
import { InputDialog } from '@/components/common/InputDialog'
import { ColorTagEditor } from '@/components/tab-groups/ColorTagEditor'
import { DedupDialog } from '@/components/tab-groups/DedupDialog'
import { MoveItemDialog } from '@/components/tab-groups/MoveItemDialog'
import { MoveToFolderDialog } from '@/components/tab-groups/MoveToFolderDialog'
import { TabGroupItemFormModal } from '@/components/tab-groups/grid/TabGroupItemFormModal'

interface TabGroupsDialogsProps {
  dialog: TabGroupDialog | null
  allGroups: TabGroupDTO[]
  isCreating: boolean
  isUpdating: boolean
  isAddingItems: boolean
  isUpdatingItem: boolean
  isDeletingGroup: boolean
  isDeletingItem: boolean
  isMovingItem: boolean
  onCreateGroup: (title: string) => void
  onRenameGroup: (title: string) => void
  onAddItems: (data: { title: string; url: string }) => void
  onEditItem: (title: string) => void
  onDeleteGroup: () => void
  onDeleteItem: () => void
  onMoveGroup: (targetParentId: string | null) => void
  onMoveItem: (targetGroupId: string) => void
  onColorTag: (color: string | null, tags: string[]) => void
  onCancel: () => void
}

/** 集中渲染标签页组页面的所有对话框(由 useTabGroupsState 的 dialog 状态驱动),减轻 TabGroupsPage 体积。 */
export function TabGroupsDialogs(props: TabGroupsDialogsProps) {
  const { t } = useTranslation('tabGroups')
  const { dialog, onCancel } = props
  if (!dialog) return null

  switch (dialog.type) {
    case 'createGroup':
      return (
        <InputDialog
          isOpen
          title={dialog.isFolder ? t('folder.createTitle') : t('action.create')}
          placeholder={dialog.isFolder ? t('folder.namePlaceholder') : t('action.createPlaceholder')}
          maxLength={dialog.isFolder ? 120 : 200}
          confirmText={t('folder.createConfirm')}
          isSubmitting={props.isCreating}
          onConfirm={props.onCreateGroup}
          onCancel={onCancel}
        />
      )
    case 'renameGroup':
      return (
        <InputDialog
          isOpen
          title={t('menu.rename')}
          initialValue={dialog.group.title}
          confirmText={t('action.save')}
          isSubmitting={props.isUpdating}
          onConfirm={props.onRenameGroup}
          onCancel={onCancel}
        />
      )
    case 'addItems':
      return (
        <TabGroupItemFormModal
          isOpen
          title={t('menu.addItem')}
          confirmText={t('item.save')}
          isSubmitting={props.isAddingItems}
          onConfirm={props.onAddItems}
          onCancel={onCancel}
        />
      )
    case 'editItem':
      return (
        <InputDialog
          isOpen
          title={t('item.edit')}
          initialValue={dialog.item.title}
          confirmText={t('item.save')}
          isSubmitting={props.isUpdatingItem}
          onConfirm={props.onEditItem}
          onCancel={onCancel}
        />
      )
    case 'confirmDeleteGroup':
      return (
        <ConfirmDialog
          isOpen
          type="danger"
          title={t('confirm.deleteGroup')}
          message={t('confirm.deleteGroupMessage', { title: dialog.group.title })}
          confirmText={t('action.delete')}
          isSubmitting={props.isDeletingGroup}
          onConfirm={props.onDeleteGroup}
          onCancel={onCancel}
        />
      )
    case 'confirmDeleteItem':
      return (
        <ConfirmDialog
          isOpen
          type="danger"
          title={t('confirm.deleteItem')}
          message={t('confirm.deleteItemMessage', { title: dialog.item.title })}
          confirmText={t('item.delete')}
          isSubmitting={props.isDeletingItem}
          onConfirm={props.onDeleteItem}
          onCancel={onCancel}
        />
      )
    case 'moveGroup':
      return (
        <MoveToFolderDialog
          isOpen
          group={dialog.group}
          allGroups={props.allGroups}
          isSubmitting={props.isUpdating}
          onConfirm={props.onMoveGroup}
          onCancel={onCancel}
        />
      )
    case 'moveItem':
      return (
        <MoveItemDialog
          isOpen
          item={dialog.item}
          currentGroupId={dialog.item.group_id}
          allGroups={props.allGroups}
          isSubmitting={props.isMovingItem}
          onConfirm={props.onMoveItem}
          onCancel={onCancel}
        />
      )
    case 'colorTag':
      return (
        <ColorTagEditor
          isOpen
          group={dialog.group}
          isSubmitting={props.isUpdating}
          onConfirm={props.onColorTag}
          onCancel={onCancel}
        />
      )
    case 'dedup':
      return <DedupDialog isOpen group={dialog.group} onCancel={onCancel} />
    default:
      return null
  }
}
