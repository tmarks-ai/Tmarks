import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { TagDTO } from '@tmarks/contracts'
import { useDeleteTag, useUpdateTag } from '@/hooks/useTags'
import { logger } from '@/lib/logger'
import { describeMutationError } from '@/lib/describe-error'
import { useToastStore } from '@/stores/toastStore'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/common/ConfirmDialog'
import { TagFormModal } from './TagFormModal'

interface TagManageModalProps {
  tags: TagDTO[]
  onClose: () => void
}

/** 标签管理弹窗(Radix Dialog):标签卡片网格,点击编辑(改名/删除)。 */
export function TagManageModal({ tags, onClose }: TagManageModalProps) {
  const { t } = useTranslation('tags')
  const { t: tc } = useTranslation('common')
  const toast = useToastStore.getState()
  const [editingTag, setEditingTag] = useState<TagDTO | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<TagDTO | null>(null)
  const [editError, setEditError] = useState('')

  const updateTag = useUpdateTag()
  const deleteTag = useDeleteTag()

  const sortedTags = useMemo(
    () => [...tags].sort((a, b) => b.bookmark_count - a.bookmark_count),
    [tags],
  )

  const handleSaveEdit = async (name: string, color: string | null) => {
    if (!editingTag || !name) return
    setEditError('')
    try {
      await updateTag.mutateAsync({ id: editingTag.id, data: { name, color } })
      setEditingTag(null)
      toast.success(t('message.updateSuccess'))
    } catch (error) {
      logger.error('Failed to update tag:', error)
      // 服务端撞名(409 TAG_EXISTS,含墓碑名)带有可执行的具体 message,
      // 泛化"更新失败"会让用户反复重试同名字而无从得知原因。
      setEditError(describeMutationError(error, tc))
    }
  }

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return
    const target = deleteTarget
    try {
      await deleteTag.mutateAsync(target.id)
      if (editingTag?.id === target.id) setEditingTag(null)
      setDeleteTarget(null)
      toast.success(t('message.deleteSuccess'))
    } catch (error) {
      logger.error('Failed to delete tag:', error)
      toast.error(describeMutationError(error, tc))
    }
  }

  return (
    <>
      <Dialog open onOpenChange={(open) => { if (!open) onClose() }}>
        <DialogContent className="max-h-[80vh] max-w-2xl gap-0 p-0" closeLabel={tc('button.close')}>
          <DialogHeader className="border-b border-border px-5 py-4">
            <DialogTitle>{t('manage.title')}</DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">{t('manage.description')}</DialogDescription>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto px-5 py-3">
            {sortedTags.length === 0 ? (
              <div className="py-12 text-center text-muted-foreground/60">
                <p className="mb-1 text-sm font-medium text-foreground">{t('manage.noTags')}</p>
                <p className="text-xs">{t('manage.noTagsHint')}</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
                {sortedTags.map((tag) => (
                  <button
                    key={tag.id}
                    type="button"
                    onClick={() => { setEditingTag(tag); setEditError('') }}
                    className="rounded-xl border border-border bg-card/95 p-3.5 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md hover:shadow-primary/10"
                  >
                    <h3 className="flex items-center gap-2 truncate text-base font-semibold text-foreground">
                      {tag.color && (
                        <span className="h-3 w-3 flex-shrink-0 rounded-full" style={{ backgroundColor: tag.color }} aria-hidden />
                      )}
                      <span className="truncate">{tag.name}</span>
                    </h3>
                    <p className="mt-0.5 text-xs text-muted-foreground/70">
                      {tag.bookmark_count === 0
                        ? t('manage.noBookmarks')
                        : t('manage.bookmarkCount', { count: tag.bookmark_count })}
                    </p>
                  </button>
                ))}
              </div>
            )}
          </div>

          <DialogFooter className="border-t border-border bg-muted/30 px-5 py-3">
            <Button className="w-full" onClick={onClose}>{t('action.done')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <TagFormModal
        isOpen={Boolean(editingTag)}
        title={t('action.edit')}
        initialName={editingTag?.name ?? ''}
        initialColor={editingTag?.color ?? null}
        onConfirm={handleSaveEdit}
        onCancel={() => { setEditingTag(null); setEditError('') }}
        isSubmitting={updateTag.isPending}
        onDelete={() => editingTag && setDeleteTarget(editingTag)}
        isDeleting={deleteTag.isPending}
        errorText={editError}
      />

      <ConfirmDialog
        isOpen={Boolean(deleteTarget)}
        title={t('confirm.deleteTitle')}
        message={t('confirm.deleteMessage', { name: deleteTarget?.name })}
        confirmText={t('action.delete')}
        type="danger"
        isSubmitting={deleteTag.isPending}
        onConfirm={handleConfirmDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </>
  )
}
