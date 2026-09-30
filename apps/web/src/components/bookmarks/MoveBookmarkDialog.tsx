import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { BookmarkDTO, BookmarkFolderDTO } from '@tmarks/contracts'
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
import { flattenFolders } from './folders/folderTree'

interface MoveBookmarkDialogProps {
  isOpen: boolean
  bookmark: BookmarkDTO | null
  folders: BookmarkFolderDTO[]
  isSubmitting: boolean
  onConfirm: (targetFolderId: string | null) => void
  onCancel: () => void
}

/** 移动书签到其他目录:扁平化目录树 + 根目录(未分类)选项,预选当前目录,同目录禁用确认。 */
export function MoveBookmarkDialog({
  isOpen,
  bookmark,
  folders,
  isSubmitting,
  onConfirm,
  onCancel,
}: MoveBookmarkDialogProps) {
  const { t } = useTranslation('bookmarks')
  const { t: tc } = useTranslation('common')
  const [selected, setSelected] = useState<string | null>(null)

  useEffect(() => {
    if (isOpen && bookmark) setSelected(bookmark.folder_id)
  }, [isOpen, bookmark])

  if (!bookmark) return null
  const options = [
    { id: '', label: t('move.rootFolder'), depth: 0 },
    ...flattenFolders(folders).map((opt) => ({ id: opt.value, label: opt.label, depth: 0 })),
  ]
  const isSame = selected === (bookmark.folder_id ?? null)

  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!open) onCancel() }}>
      <DialogContent closeLabel={tc('button.close')}>
        <DialogHeader>
          <DialogTitle>{t('move.bookmarkTitle')}</DialogTitle>
          <DialogDescription>{t('move.bookmarkDescription', { title: bookmark.title })}</DialogDescription>
        </DialogHeader>
        <MoveOptionList options={options} selectedId={selected} emptyLabel={t('move.noFolders')} onSelect={setSelected} />
        <DialogFooter>
          <Button variant="outline" onClick={onCancel} disabled={isSubmitting}>
            {tc('button.cancel')}
          </Button>
          <Button onClick={() => onConfirm(selected)} disabled={isSubmitting || isSame} showPendingIndicator>
            {t('move.confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}