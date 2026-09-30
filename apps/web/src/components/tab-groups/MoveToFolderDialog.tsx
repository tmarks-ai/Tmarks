import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { TabGroupDTO } from '@tmarks/contracts'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { MoveOptionList } from '@/components/common/MoveOptionList'
import { flattenTabGroupFoldersForMove } from '@/lib/folder-move'

interface MoveToFolderDialogProps {
  isOpen: boolean
  group: TabGroupDTO | null
  allGroups: TabGroupDTO[]
  isSubmitting: boolean
  onConfirm: (targetParentId: string | null) => void
  onCancel: () => void
}

/** 移动到文件夹对话框:folder tree 选择(排除自身子树防环 + 根目录选项)+ 确认禁用同 parent。 */
export function MoveToFolderDialog({
  isOpen,
  group,
  allGroups,
  isSubmitting,
  onConfirm,
  onCancel,
}: MoveToFolderDialogProps) {
  const { t } = useTranslation('tabGroups')
  const { t: tc } = useTranslation('common')
  const [selected, setSelected] = useState<string | null>(null)

  useEffect(() => {
    if (isOpen && group) setSelected(group.parent_id ?? null)
  }, [isOpen, group])

  if (!group) return null
  const options = [
    { id: '', label: t('moveToFolder.rootFolder'), depth: 0 },
    ...flattenTabGroupFoldersForMove(allGroups, group.id),
  ]
  const isSameParent = selected === (group.parent_id ?? null)

  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!open) onCancel() }}>
      <DialogContent closeLabel={tc('button.close')}>
        <DialogHeader>
          <DialogTitle>{t('moveToFolder.title')}</DialogTitle>
          <DialogDescription>{t('moveToFolder.description', { title: group.title })}</DialogDescription>
        </DialogHeader>
        <MoveOptionList options={options} selectedId={selected} emptyLabel={t('moveToFolder.noFolders')} onSelect={setSelected} />
        <DialogFooter>
          <Button variant="outline" onClick={onCancel} disabled={isSubmitting}>
            {tc('button.cancel')}
          </Button>
          <Button onClick={() => onConfirm(selected)} disabled={isSubmitting || isSameParent} showPendingIndicator>
            {t('moveToFolder.confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}