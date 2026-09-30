import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { BookmarkDTO, BookmarkFolderDTO } from '@tmarks/contracts'
import { useBatchAction } from '@/hooks/useBookmarks'
import { useBookmarkFolders } from '@/hooks/useBookmarkFolders'
import { useTags } from '@/hooks/useTags'
import { useToastStore } from '@/stores/toastStore'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { ConfirmDialog } from '@/components/common/ConfirmDialog'
import { BatchActionBar as CommonBatchActionBar } from '@/components/common/BatchActionBar'
import { downloadBlob, exportBookmarksMarkdown } from '@/lib/export-bookmarks'

interface BatchActionBarProps {
  /**
   * The selected bookmarks themselves, not ids to be looked up in the current
   * page — selection survives pagination, so a page-scoped lookup silently
   * dropped everything chosen on earlier pages.
   */
  selectedBookmarks: BookmarkDTO[]
  totalCount: number
  onSelectAll: () => void
  onClearSelection: () => void
}

type PendingAction = 'delete' | 'pin' | 'unpin' | 'todo' | 'untodo' | 'archive' | 'unarchive' | null

function flattenFolders(folders: BookmarkFolderDTO[], parentPath: string[] = []): Array<{ id: string; label: string }> {
  return folders.flatMap((folder) => {
    const path = [...parentPath, folder.name]
    return [{ id: folder.id, label: path.join(' / ') }, ...flattenFolders(folder.children ?? [], path)]
  })
}

const TITLE_PREVIEW_LIMIT = 40
const TITLE_PREVIEW_COUNT = 5

/** 构造批量删除的预览文案:前 N 条 title(单行 40 字截断)+「…还有 X 条」补充。 */
function buildDeletePreviewMessage(
  selected: BookmarkDTO[],
  selectedCount: number,
  t: (key: string, opts?: Record<string, unknown>) => string,
): string {
  const lines: string[] = [t('batch.deleteMessage', { count: selectedCount })]
  if (selected.length === 0) return lines.join('\n')
  const preview = selected.slice(0, TITLE_PREVIEW_COUNT)
  preview.forEach((bookmark, idx) => {
    const raw = bookmark.title ?? ''
    const truncated = raw.length > TITLE_PREVIEW_LIMIT ? `${raw.slice(0, TITLE_PREVIEW_LIMIT)}…` : raw
    lines.push(`${idx + 1}. ${truncated}`)
  })
  if (selectedCount > preview.length) {
    lines.push(t('batch.deletePreviewMore', { count: selectedCount - preview.length }))
  }
  return lines.join('\n')
}

/** 书签批量操作栏(common/BatchActionBar 适配层 + 移动/标签下拉与状态确认)。 */
export function BatchActionBar({
  selectedBookmarks,
  totalCount,
  onSelectAll,
  onClearSelection,
}: BatchActionBarProps) {
  const { t } = useTranslation('bookmarks')
  const toast = useToastStore.getState()
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([])
  const [pendingAction, setPendingAction] = useState<PendingAction>(null)
  const [showConfirm, setShowConfirm] = useState(false)
  const batchAction = useBatchAction()
  const { data: tagsData } = useTags({ sort: 'name' })
  const { data: foldersData } = useBookmarkFolders()
  const tags = tagsData?.tags ?? []
  const folders = flattenFolders(foldersData?.folders ?? [])

  const selectedCount = selectedBookmarks.length
  const hasSelection = selectedCount > 0
  const isPending = batchAction.isPending
  const canPin = selectedBookmarks.some((bookmark) => !bookmark.is_pinned)
  const canUnpin = selectedBookmarks.some((bookmark) => bookmark.is_pinned)
  const canMarkTodo = selectedBookmarks.some((bookmark) => !bookmark.is_todo)
  const canUnmarkTodo = selectedBookmarks.some((bookmark) => bookmark.is_todo)
  const canArchive = selectedBookmarks.some((bookmark) => !bookmark.is_archived)
  const canUnarchive = selectedBookmarks.some((bookmark) => bookmark.is_archived)

  const runStateAction = async (action: NonNullable<PendingAction>) => {
    try {
      const { successCount, failedCount } = await batchAction.mutateAsync({ action, bookmarks: selectedBookmarks })
      if (failedCount > 0) {
        toast.warning(t('batch.partialFailed', { success: successCount, failed: failedCount }))
      } else {
        toast.success(t(`batch.${action}Success`, { count: selectedCount }))
        onClearSelection()
      }
    } catch {
      // The mutation hook owns the localized error toast.
    } finally {
      setShowConfirm(false)
      setPendingAction(null)
    }
  }

  const runDelete = () => {
    void runStateAction('delete').catch(() => undefined)
  }

  const handleAction = (action: NonNullable<PendingAction>) => {
    if (!hasSelection) return
    setPendingAction(action)
    setShowConfirm(true)
  }

  const toggleTag = (tagId: string) => {
    setSelectedTagIds((ids) => (ids.includes(tagId) ? ids.filter((id) => id !== tagId) : [...ids, tagId]))
  }

  const handleUpdateTags = async (mode: 'add' | 'remove') => {
    if (!hasSelection || selectedTagIds.length === 0) return
    try {
      const { successCount, failedCount } = await batchAction.mutateAsync({
        action: 'update_tags',
        bookmarks: selectedBookmarks,
        add_tag_ids: mode === 'add' ? selectedTagIds : undefined,
        remove_tag_ids: mode === 'remove' ? selectedTagIds : undefined,
      })
      if (failedCount > 0) toast.warning(t('batch.partialFailed', { success: successCount, failed: failedCount }))
      else toast.success(t(`batch.${mode === 'add' ? 'addTagsSuccess' : 'removeTagsSuccess'}`, { count: successCount }))
      if (failedCount === 0) onClearSelection()
    } catch {
      // The mutation hook owns the localized error toast.
    } finally {
      setSelectedTagIds([])
    }
  }

  const handleMove = async (folderId: string | null) => {
    if (!hasSelection) return
    try {
      const { successCount, failedCount } = await batchAction.mutateAsync({ action: 'move', bookmarks: selectedBookmarks, folder_id: folderId })
      if (failedCount > 0) toast.warning(t('batch.partialFailed', { success: successCount, failed: failedCount }))
      else {
        toast.success(t('action.moveSuccess'))
        onClearSelection()
      }
    } catch {
      // The mutation hook owns the localized error toast.
    } finally {
      setSelectedTagIds([])
    }
  }

  const handleExport = () => {
    if (!hasSelection) return
    const blob = exportBookmarksMarkdown(selectedBookmarks, t('batch.exportTitle'))
    downloadBlob(blob, `bookmarks-${new Date().toISOString().slice(0, 10)}.md`)
  }

  const confirmConfig =
    pendingAction === 'unpin'
      ? { title: t('batch.unpinTitle'), message: t('batch.unpinMessage', { count: selectedCount }), confirmText: t('batch.unpin') }
      : pendingAction === 'todo' || pendingAction === 'untodo'
        ? { title: t('batch.confirmAction'), message: t('batch.confirmMessage'), confirmText: t(pendingAction === 'todo' ? 'action.markTodo' : 'action.unmarkTodo') }
        : pendingAction === 'archive' || pendingAction === 'unarchive'
          ? { title: t('batch.confirmAction'), message: t('batch.confirmMessage'), confirmText: t(pendingAction === 'archive' ? 'batch.archive' : 'batch.unarchive') }
          : { title: t('batch.pinTitle'), message: t('batch.pinMessage', { count: selectedCount }), confirmText: t('batch.pin') }

  const extraActions = (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" disabled={isPending}>{t('move.title')}</Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="max-h-80 overflow-y-auto">
          <DropdownMenuLabel>{t('move.title')}</DropdownMenuLabel>
          <DropdownMenuItem onSelect={() => { void handleMove(null) }}>{t('move.rootFolder')}</DropdownMenuItem>
          {folders.map((folder) => <DropdownMenuItem key={folder.id} onSelect={() => { void handleMove(folder.id) }}>{folder.label}</DropdownMenuItem>)}
        </DropdownMenuContent>
      </DropdownMenu>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" disabled={isPending}>{t('batch.tags')}</Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="max-h-80 overflow-y-auto">
          <DropdownMenuLabel>{t('batch.selectTags')}</DropdownMenuLabel>
          {tags.map((tag) => (
            <DropdownMenuCheckboxItem
              key={tag.id}
              checked={selectedTagIds.includes(tag.id)}
              onCheckedChange={() => toggleTag(tag.id)}
              onSelect={(event) => event.preventDefault()}
            >
              {tag.name}
            </DropdownMenuCheckboxItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            disabled={selectedTagIds.length === 0 || isPending}
            onSelect={() => { void handleUpdateTags('add') }}
          >
            {t('batch.addTags')}
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={selectedTagIds.length === 0 || isPending}
            onSelect={() => { void handleUpdateTags('remove') }}
          >
            {t('batch.removeTags')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  )

  return (
    <>
      <CommonBatchActionBar
        t={t}
        selectedCount={selectedCount}
        totalCount={totalCount}
        isPending={isPending}
        canPin={canPin}
        canUnpin={canUnpin}
        canTodo={canMarkTodo}
        canUntodo={canUnmarkTodo}
        canArchive={canArchive}
        canUnarchive={canUnarchive}
        onSelectAll={onSelectAll}
        onClearSelection={onClearSelection}
        onPin={() => handleAction('pin')}
        onUnpin={() => handleAction('unpin')}
        onTodo={() => handleAction('todo')}
        onUntodo={() => handleAction('untodo')}
        onArchive={() => handleAction('archive')}
        onUnarchive={() => handleAction('unarchive')}
        onExport={handleExport}
        onDelete={runDelete}
        deleteTitle={t('batch.deleteTitle')}
        deleteMessage={buildDeletePreviewMessage(selectedBookmarks, selectedCount, t)}
        totalLabel={t('batch.currentPage', { count: totalCount })}
        todoLabel={t('action.markTodo')}
        untodoLabel={t('action.unmarkTodo')}
        clearLabel={t('batch.clearSelection')}
        processingLabel={t('batch.processing')}
        extraActions={extraActions}
      />
      <ConfirmDialog
        isOpen={showConfirm}
        title={confirmConfig.title}
        message={confirmConfig.message}
        confirmText={confirmConfig.confirmText}
        isSubmitting={isPending}
        onConfirm={() => { void runStateAction(pendingAction!) }}
        onCancel={() => { setShowConfirm(false); setPendingAction(null) }}
      />
    </>
  )
}