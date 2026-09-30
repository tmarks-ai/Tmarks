import { useState } from 'react'
import type { BookmarkDTO, BookmarkFolderDTO } from '@tmarks/contracts'
import { useBookmarkFilters, type BookmarkFilterDefaults } from '@/hooks/useBookmarkFilters'
import { useBookmarkSelection } from './useBookmarkSelection'

type BookmarkDialog =
  | { type: 'moveBookmark'; bookmark: BookmarkDTO }
  | { type: 'moveFolder'; folder: BookmarkFolderDTO }

/** 书签页面聚合状态:筛选 + 表单/编辑 + 移动对话框状态机 + 批量选择。 */
export function useBookmarksState(defaults?: BookmarkFilterDefaults) {
  const filters = useBookmarkFilters(defaults)
  const [showForm, setShowForm] = useState(false)
  const [editingBookmark, setEditingBookmark] = useState<BookmarkDTO | null>(null)
  const [dialog, setDialog] = useState<BookmarkDialog | null>(null)
  const [batchMode, setBatchMode] = useState(false)
  const selection = useBookmarkSelection()

  return {
    ...filters,
    showForm,
    setShowForm,
    editingBookmark,
    setEditingBookmark,
    dialog,
    openMoveBookmark: (bookmark: BookmarkDTO) => setDialog({ type: 'moveBookmark', bookmark }),
    openMoveFolder: (folder: BookmarkFolderDTO) => setDialog({ type: 'moveFolder', folder }),
    closeDialog: () => setDialog(null),
    batchMode,
    setBatchMode,
    selection,
  }
}
