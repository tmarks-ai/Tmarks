import { useState } from 'react'
import { useTags } from '@/hooks/useTags'
import { useBookmarkFolders } from '@/hooks/useBookmarkFolders'
import { useTranslation } from 'react-i18next'
import { Loader2 } from 'lucide-react'
import { safeImageSrc } from '@/lib/safe-url'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Checkbox } from '@/components/ui/checkbox'
import { ConfirmDialog } from '@/components/common/ConfirmDialog'
import { useBookmarkForm } from './useBookmarkForm'
import { TagSelector } from './TagSelector'
import { BookmarkFolderSelect } from './folders/BookmarkFolderSelect'
import type { BookmarkDTO } from '@tmarks/contracts'

interface BookmarkFormProps {
  bookmark?: BookmarkDTO | null
  onClose: () => void
  onSuccess?: () => void
}

/** 书签创建/编辑表单(Radix Dialog 受控,由父级条件渲染控制挂载)。 */
export function BookmarkForm({ bookmark, onClose, onSuccess }: BookmarkFormProps) {
  const { t } = useTranslation('common')
  const { data: tagsData } = useTags()
  const { data: foldersData } = useBookmarkFolders()
  const tags = tagsData?.tags ?? []
  const folders = foldersData?.folders ?? []
  const form = useBookmarkForm({ bookmark, onClose, onSuccess, tags })
  // favicon 加载失败标记(按 src 记):命令式 display:none 会在 src 更换后残留,
  // 这里改为受控——换图自动恢复显示,新图再次失败才重新隐藏。
  const [brokenFavicon, setBrokenFavicon] = useState<string | null>(null)
  const faviconSrc = safeImageSrc(form.favicon)

  return (
    <>
      <Dialog open onOpenChange={(open) => { if (!open) onClose() }}>
        <DialogContent className="max-w-2xl" closeLabel={t('button.close')}>
          <DialogHeader>
            <DialogTitle>{form.isEditing ? form.t('form.editTitle') : form.t('form.addTitle')}</DialogTitle>
            <DialogDescription className="sr-only">
              {form.isEditing ? form.t('form.editTitle') : form.t('form.addTitle')}
            </DialogDescription>
          </DialogHeader>

          {form.error && (
            <p className="text-sm text-destructive">{form.error}</p>
          )}

          <form onSubmit={form.handleSubmit} className="space-y-3">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label htmlFor="title" className="mb-1.5 block text-xs font-medium">
                  {form.t('form.titleRequired')} *
                </label>
                <Input
                  id="title"
                  placeholder={form.t('form.titlePlaceholder')}
                  value={form.title}
                  onChange={(e) => form.setTitle(e.target.value)}
                  disabled={form.isPending}
                  maxLength={500}
                  autoFocus
                />
              </div>
              <div>
                <label htmlFor="url" className="mb-1.5 block text-xs font-medium">
                  {form.t('form.urlRequired')} *
                </label>
                <div className="flex items-center gap-2">
                  {faviconSrc && faviconSrc !== brokenFavicon ? (
                    <img
                      src={faviconSrc}
                      alt=""
                      className="h-5 w-5 flex-shrink-0 rounded"
                      onError={() => setBrokenFavicon(faviconSrc)}
                    />
                  ) : null}
                  <Input
                    id="url"
                    type="url"
                    placeholder={form.t('form.urlPlaceholder')}
                    value={form.url}
                    onChange={(e) => form.setUrl(e.target.value)}
                    disabled={form.isPending}
                    maxLength={2000}
                  />
                </div>
                {form.metaStatus === 'fetching' && (
                  <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                    <Loader2 className="h-3 w-3 animate-spin" /> {form.t('form.metaFetching')}
                  </p>
                )}
                {form.metaStatus === 'error' && (
                  <p className="mt-1 text-xs text-muted-foreground/70">{form.t('form.metaFailed')}</p>
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label htmlFor="description" className="mb-1.5 block text-xs font-medium">
                  {form.t('form.description')}
                </label>
                <Textarea
                  id="description"
                  placeholder={form.t('form.descriptionPlaceholder')}
                  value={form.description}
                  onChange={(e) => form.setDescription(e.target.value)}
                  disabled={form.isPending}
                  className="min-h-[60px]"
                  maxLength={1000}
                />
              </div>
              <div>
                <label htmlFor="coverImage" className="mb-1.5 block text-xs font-medium">
                  {form.t('form.coverImage')}
                </label>
                <Input
                  id="coverImage"
                  type="url"
                  placeholder={form.t('form.coverImagePlaceholder')}
                  value={form.coverImage}
                  onChange={(e) => form.setCoverImage(e.target.value)}
                  disabled={form.isPending}
                  maxLength={2000}
                />
              </div>
            </div>

            <BookmarkFolderSelect
              folders={folders}
              value={form.folderId}
              onChange={form.setFolderId}
              disabled={form.isPending}
            />

            <TagSelector
              tagInput={form.tagInput}
              setTagInput={form.setTagInput}
              onTagInputKeyDown={form.handleTagInputKeyDown}
              selectedTagIds={form.selectedTagIds}
              toggleTag={form.toggleTag}
              tags={tags}
              isPending={form.isPending}
            />

            <div className="flex items-center justify-between border-t border-border pt-3">
              <div className="flex gap-4">
                <label className="flex cursor-pointer items-center gap-1.5">
                  <Checkbox checked={form.isPinned} onCheckedChange={form.setIsPinned} disabled={form.isPending} />
                  <span className="text-xs">{form.t('form.pinned')}</span>
                </label>
                <label className="flex cursor-pointer items-center gap-1.5">
                  <Checkbox checked={form.isTodo} onCheckedChange={form.setIsTodo} disabled={form.isPending} />
                  <span className="text-xs">{form.t('form.todo')}</span>
                </label>
                <label className="flex cursor-pointer items-center gap-1.5">
                  <Checkbox checked={form.isPrivate} onCheckedChange={form.setIsPrivate} disabled={form.isPending} />
                  <span className="text-xs">{form.t('form.private')}</span>
                </label>
              </div>
              <div className="flex gap-2">
                {form.isEditing && (
                  <Button type="button" variant="outline" onClick={form.handleDeleteClick} disabled={form.isPending}>
                    {form.t('form.delete')}
                  </Button>
                )}
                <Button type="submit" disabled={form.isPending} showPendingIndicator>
                  {form.isEditing ? form.t('form.save') : form.t('form.create')}
                </Button>
                <Button type="button" variant="outline" onClick={onClose} disabled={form.isPending}>
                  {form.t('form.cancel')}
                </Button>
              </div>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        isOpen={form.showDeleteConfirm}
        title={form.t('form.deleteTitle')}
        message={form.t('form.deleteMessage')}
        type="danger"
        confirmText={form.t('form.delete')}
        isSubmitting={form.isPending}
        onConfirm={form.handleConfirmDelete}
        onCancel={() => form.setShowDeleteConfirm(false)}
      />
    </>
  )
}
