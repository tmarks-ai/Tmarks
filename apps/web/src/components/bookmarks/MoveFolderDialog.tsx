import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { BookmarkFolderDTO } from '@tmarks/contracts'
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
import { flattenBookmarkFoldersForMove } from '@/lib/folder-move'
import { findFolderById, getFolderWithDescendantIds } from './folders/folderTree'

interface MoveFolderDialogProps {
  isOpen: boolean
  folder: BookmarkFolderDTO | null
  folders: BookmarkFolderDTO[]
  isSubmitting: boolean
  onConfirm: (targetParentId: string | null) => void
  onCancel: () => void
}

/** 移动目录到其他父目录:排除自身及后代子树防环 + 根目录选项,预选当前父目录,同父目录禁用确认。 */
export function MoveFolderDialog({
  isOpen,
  folder,
  folders,
  isSubmitting,
  onConfirm,
  onCancel,
}: MoveFolderDialogProps) {
  const { t } = useTranslation('bookmarks')
  const { t: tc } = useTranslation('common')
  const [selected, setSelected] = useState<string | null>(null)

  useEffect(() => {
    if (isOpen && folder) setSelected(folder.parent_id ?? null)
  }, [isOpen, folder])

  if (!folder) return null
  const target = findFolderById(folders, folder.id)
  const excluded = new Set(target ? getFolderWithDescendantIds(target) : [folder.id])
  // R8 WE-2: 只列出后端会接受的目标(folders/update.ts:42-53)——目标只能是根
  // 或一级目录(两级结构 → flatten 的 depth 0),且带子夹的目录只能移回根。
  // 此前列出的二级目标/带子夹的任意目标必然 400,且失败零反馈。
  const movingHasChildren = excluded.size > 1
  const available = flattenBookmarkFoldersForMove(folders, excluded).filter((option) =>
    movingHasChildren ? false : option.depth === 0
  )
  const options = [{ id: '', label: t('move.rootFolder'), depth: 0 }, ...available]
  const isSameParent = selected === (folder.parent_id ?? null)

  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!open) onCancel() }}>
      <DialogContent closeLabel={tc('button.close')}>
        <DialogHeader>
          <DialogTitle>{t('move.folderTitle')}</DialogTitle>
          <DialogDescription>{t('move.folderDescription', { name: folder.name })}</DialogDescription>
        </DialogHeader>
        <MoveOptionList options={options} selectedId={selected} emptyLabel={t('move.noFolders')} onSelect={setSelected} />
        <DialogFooter>
          <Button variant="outline" onClick={onCancel} disabled={isSubmitting}>
            {tc('button.cancel')}
          </Button>
          <Button onClick={() => onConfirm(selected)} disabled={isSubmitting || isSameParent} showPendingIndicator>
            {t('move.confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
