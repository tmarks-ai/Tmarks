import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { TabGroupDTO, TabGroupItemDTO } from '@tmarks/contracts'
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

interface MoveItemDialogProps {
  isOpen: boolean
  item: TabGroupItemDTO | null
  currentGroupId: string | null
  allGroups: TabGroupDTO[]
  isSubmitting: boolean
  onConfirm: (targetGroupId: string) => void
  onCancel: () => void
}

/** 移动条目到其他组对话框:content groups 列表(排除当前组 + 文件夹)+ 选择确认。 */
export function MoveItemDialog({
  isOpen,
  item,
  currentGroupId,
  allGroups,
  isSubmitting,
  onConfirm,
  onCancel,
}: MoveItemDialogProps) {
  const { t } = useTranslation('tabGroups')
  const { t: tc } = useTranslation('common')
  const [selected, setSelected] = useState('')

  useEffect(() => {
    if (isOpen) setSelected('')
  }, [isOpen])

  if (!item) return null
  const options = allGroups
    .filter((g) => !g.is_folder && g.id !== currentGroupId)
    .map((g) => ({ id: g.id, label: g.title, depth: 0 }))

  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!open) onCancel() }}>
      <DialogContent closeLabel={tc('button.close')}>
        <DialogHeader>
          <DialogTitle>{t('menu.moveToOtherGroup')}</DialogTitle>
          <DialogDescription>{item.title}</DialogDescription>
        </DialogHeader>
        <MoveOptionList
          options={options}
          selectedId={selected}
          emptyLabel={t('moveToFolder.noFolders')}
          onSelect={(id) => setSelected(id ?? '')}
        />
        <DialogFooter>
          <Button variant="outline" onClick={onCancel} disabled={isSubmitting}>
            {tc('button.cancel')}
          </Button>
          <Button onClick={() => onConfirm(selected)} disabled={isSubmitting || !selected} showPendingIndicator>
            {t('moveToFolder.confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}