import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import type { BookmarkDTO, ReorderBookmarkItem } from '@tmarks/contracts'
import { useReorderBookmarks, useUpdateBookmark } from '@/hooks/useBookmarks'
import { useUpdateBookmarkFolder } from '@/hooks/useBookmarkFolders'
import { describeMutationError } from '@/lib/describe-error'
import { logger } from '@/lib/logger'
import { useToastStore } from '@/stores/toastStore'

/**
 * Mutation handlers for the bookmark workspace: per-bookmark status toggles,
 * folder moves and manual reordering, each with its own success toast.
 *
 * Kept out of BookmarksPage so the page stays a composition of state + layout
 * rather than also owning the mutation wiring.
 */
export function useBookmarkActions(onMoveComplete: () => void) {
  const { t } = useTranslation('bookmarks')
  const { t: tc } = useTranslation('common')
  const toast = useToastStore.getState()
  const updateBookmark = useUpdateBookmark()
  const updateFolder = useUpdateBookmarkFolder()
  const reorderBookmarks = useReorderBookmarks()

  const togglePin = useCallback((bookmark: BookmarkDTO) => {
    updateBookmark.mutate(
      { id: bookmark.id, data: { is_pinned: !bookmark.is_pinned } },
      { onSuccess: () => toast.success(t(bookmark.is_pinned ? 'action.unpinSuccess' : 'action.pinSuccess')) },
    )
  }, [updateBookmark, toast, t])

  const toggleTodo = useCallback((bookmark: BookmarkDTO) => {
    updateBookmark.mutate(
      { id: bookmark.id, data: { is_todo: !bookmark.is_todo } },
      { onSuccess: () => toast.success(t('action.todoSuccess')) },
    )
  }, [updateBookmark, toast, t])

  const toggleArchive = useCallback((bookmark: BookmarkDTO) => {
    updateBookmark.mutate(
      { id: bookmark.id, data: { is_archived: !bookmark.is_archived } },
      { onSuccess: () => toast.success(t(bookmark.is_archived ? 'action.unarchiveSuccess' : 'action.archiveSuccess')) },
    )
  }, [updateBookmark, toast, t])

  const moveBookmark = useCallback((bookmarkId: string, targetFolderId: string | null) => {
    updateBookmark.mutate(
      { id: bookmarkId, data: { folder_id: targetFolderId } },
      { onSuccess: () => { toast.success(t('action.moveSuccess')); onMoveComplete() } },
    )
  }, [updateBookmark, toast, t, onMoveComplete])

  const moveFolder = useCallback((folderId: string, targetParentId: string | null) => {
    // R8 WE-2: 此前只有 onSuccess——被后端拒绝(环/层级规则)时对话框不关、
    // 无任何提示,与同面板 DnD 路径(有 describeMutationError toast)不一致。
    updateFolder.mutate(
      { id: folderId, data: { parent_id: targetParentId } },
      {
        onSuccess: onMoveComplete,
        onError: (error) => {
          logger.error('Failed to move folder:', error)
          toast.error(describeMutationError(error, (key) => tc(key)))
        },
      },
    )
  }, [updateFolder, onMoveComplete, toast, tc])

  const reorder = useCallback((updates: ReorderBookmarkItem[]) => {
    reorderBookmarks.mutate({ updates }, { onSuccess: () => toast.success(t('action.reorderSuccess')) })
  }, [reorderBookmarks, toast, t])

  return {
    togglePin,
    toggleTodo,
    toggleArchive,
    moveBookmark,
    moveFolder,
    reorder,
    isMovingBookmark: updateBookmark.isPending,
    isMovingFolder: updateFolder.isPending,
  }
}
