import { useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import type { ReactNode } from 'react'
import { Bookmark, Folder, FolderPlus, Inbox, Layers3 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { BookmarkFolderDTO } from '@tmarks/contracts'
import {
  ALL_BOOKMARKS_FOLDER,
  UNCATEGORIZED_FOLDER,
  type BookmarkFolderFilter,
} from '@/lib/constants/bookmarks'
import {
  useCreateBookmarkFolder,
  useDeleteBookmarkFolder,
  useReorderBookmarkFolders,
  useUpdateBookmarkFolder,
} from '@/hooks/useBookmarkFolders'
import { ConfirmDialog } from '@/components/common/ConfirmDialog'
import { InputDialog } from '@/components/common/InputDialog'
import { logger } from '@/lib/logger'
import { describeMutationError } from '@/lib/describe-error'
import { useToastStore } from '@/stores/toastStore'
import { DndContext, DragOverlay } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { BookmarkFolderNode } from './BookmarkFolderNode'
import { useBookmarkFolderDragAndDrop } from './useBookmarkFolderDragAndDrop'
import { flattenFolderTree, getFolderWithDescendantIds } from './folderTree'

type FolderDialogState =
  | { mode: 'create'; parentId: string | null }
  | { mode: 'rename'; folder: BookmarkFolderDTO }
  | null

interface BookmarkFolderPanelProps {
  folders: BookmarkFolderDTO[]
  selectedId: BookmarkFolderFilter
  totalCount: number
  uncategorizedCount: number
  isLoading?: boolean
  isError?: boolean
  onRetry?: () => void
  readOnly?: boolean
  onSelect: (folderId: BookmarkFolderFilter) => void
  onMove?: (folder: BookmarkFolderDTO) => void
}

/** 左栏目录面板:系统目录(全部/未分类)+ 用户目录树 + 增删改(Radix Dialog)。 */
export function BookmarkFolderPanel({
  folders,
  selectedId,
  totalCount,
  uncategorizedCount,
  isLoading,
  isError,
  onRetry,
  readOnly,
  onSelect,
  onMove,
}: BookmarkFolderPanelProps) {
  const { t } = useTranslation('bookmarks')
  const { t: tc } = useTranslation('common')
  const [folderDialog, setFolderDialog] = useState<FolderDialogState>(null)
  const [deleteTarget, setDeleteTarget] = useState<BookmarkFolderDTO | null>(null)
  const createFolder = useCreateBookmarkFolder()
  const updateFolder = useUpdateBookmarkFolder()
  const deleteFolder = useDeleteBookmarkFolder()
  const reorderFolders = useReorderBookmarkFolders()
  const toast = useToastStore.getState()
  // 目录重排互斥:两次快速拖拽基于同一快照并发计算位置会互相覆盖;ref 闸拦下第二次。
  const reorderingRef = useRef(false)

  const handleReorderFolder = async (folderId: string, newParentId: string | null, newPosition: number) => {
    if (reorderingRef.current) return
    const flat = flattenFolderTree(folders)
    const dragged = flat.find((f) => f.id === folderId)
    if (!dragged) return
    reorderingRef.current = true
    try {
      // 移动先行(层级校验单点保持在 PATCH,被拒时顺序批次不发出);
      // R5-13: 顺序其后一次批量请求落整层新顺序(含被拖项),替代逐兄弟 N 个 PATCH。
      await updateFolder.mutateAsync({ id: folderId, data: { parent_id: newParentId, position: newPosition } })
      const siblings = flat.filter((f) => (f.parent_id ?? null) === newParentId && f.id !== folderId)
      const reordered = [...siblings]
      reordered.splice(newPosition, 0, dragged)
      await reorderFolders.mutateAsync({ updates: reordered.map((f, i) => ({ id: f.id, position: i })) })
      toast.success(t('action.reorderSuccess'))
    } catch (error) {
      logger.error('Failed to reorder folder:', error)
      toast.error(describeMutationError(error, tc))
    } finally {
      reorderingRef.current = false
    }
  }
  const dnd = useBookmarkFolderDragAndDrop({ folders, onMoveFolder: handleReorderFolder })
  const folderIds = flattenFolderTree(folders).map((f) => f.id)

  const handleSubmitFolderName = async (name: string) => {
    if (!folderDialog) return
    try {
      if (folderDialog.mode === 'create') {
        await createFolder.mutateAsync({ name, parent_id: folderDialog.parentId })
      } else if (name !== folderDialog.folder.name) {
        await updateFolder.mutateAsync({ id: folderDialog.folder.id, data: { name } })
      }
      setFolderDialog(null)
      toast.success(t('action.success'))
    } catch {
      toast.error(t('message.operationFailed'))
    }
  }

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return
    const target = deleteTarget
    try {
      await deleteFolder.mutateAsync(target.id)
      // 整棵子树(任意深度)含当前选中目录时回退"全部":此前只查一层子目录,
      // 删祖先后孙目录的选中项指向已删 id,列表静默空白。
      if (getFolderWithDescendantIds(target).includes(selectedId)) {
        onSelect(ALL_BOOKMARKS_FOLDER)
      }
      toast.success(t('action.success'))
    } catch {
      toast.error(t('message.operationFailed'))
    } finally {
      setDeleteTarget(null)
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col rounded-2xl border border-border/70 bg-card/90 p-3 shadow-sm">
      <div className="mb-3 flex flex-shrink-0 items-center gap-3 rounded-xl border border-border/60 bg-muted/25 px-3 py-3">
        <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Layers3 className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-base font-bold text-primary">{t('folders.title')}</h3>
        </div>
        {!readOnly && (
          <button
            type="button"
            onClick={() => setFolderDialog({ mode: 'create', parentId: null })}
            className="ml-auto rounded-md p-2 text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label={t('folders.newFolder')}
          >
            <FolderPlus className="h-4 w-4" />
          </button>
        )}
      </div>

      <div className="scrollbar-hide flex-1 min-h-0 space-y-1 overflow-y-auto overscroll-contain">
        <SystemFolder
          icon={<Bookmark className="h-4 w-4" />}
          label={t('folders.all')}
          count={totalCount}
          active={selectedId === ALL_BOOKMARKS_FOLDER}
          onClick={() => onSelect(ALL_BOOKMARKS_FOLDER)}
        />
        <SystemFolder
          icon={<Inbox className="h-4 w-4" />}
          label={t('folders.uncategorized')}
          count={uncategorizedCount}
          active={selectedId === UNCATEGORIZED_FOLDER}
          onClick={() => onSelect(UNCATEGORIZED_FOLDER)}
        />

        <div className="pt-3">
          <div className="mb-3 border-t border-border/70" />
          {isError ? (
            <div className="py-6 text-center">
              <p className="mb-2 text-sm text-destructive">{t('error')}</p>
              {onRetry && (
                <button type="button" onClick={onRetry} className="text-xs font-medium text-primary hover:underline">
                  {t('retry')}
                </button>
              )}
            </div>
          ) : isLoading ? (
            <div className="py-6 text-center text-sm text-muted-foreground">{t('folders.loading')}</div>
          ) : folders.length === 0 ? (
            <div className="py-6 text-center text-sm text-muted-foreground">{t('folders.empty')}</div>
          ) : (
            <DndContext
              sensors={dnd.sensors}
              collisionDetection={dnd.collisionDetection}
              onDragStart={dnd.handleDragStart}
              onDragMove={dnd.handleDragMove}
              onDragEnd={dnd.handleDragEnd}
              onDragCancel={dnd.handleDragCancel}
            >
              <SortableContext items={folderIds} strategy={verticalListSortingStrategy}>
                {folders.map((folder) => (
                  <BookmarkFolderNode
                    key={folder.id}
                    folder={folder}
                    selectedId={selectedId}
                    readOnly={readOnly}
                    onSelect={onSelect}
                    onCreateChild={(parentId) => setFolderDialog({ mode: 'create', parentId })}
                    onRename={(folder) => setFolderDialog({ mode: 'rename', folder })}
                    onDelete={setDeleteTarget}
                    onMove={onMove}
                    overId={dnd.overId}
                    dropPosition={dnd.dropPosition}
                  />
                ))}
              </SortableContext>
              <DragOverlay>
                {dnd.activeFolder ? (
                  <div className="flex items-center gap-1 rounded-lg bg-card px-2 py-1.5 shadow-lg">
                    <Folder className="h-4 w-4 text-primary" />
                    <span className="text-sm font-medium">{dnd.activeFolder.name}</span>
                  </div>
                ) : null}
              </DragOverlay>
            </DndContext>
          )}
        </div>
      </div>

      <InputDialog
        isOpen={Boolean(folderDialog)}
        title={getFolderDialogTitle(folderDialog, t)}
        description={getFolderDialogDescription(folderDialog, t)}
        placeholder={t('folders.namePlaceholder')}
        maxLength={120}
        initialValue={folderDialog?.mode === 'rename' ? folderDialog.folder.name : ''}
        confirmText={folderDialog?.mode === 'create' ? t('folders.create') : t('folders.save')}
        isSubmitting={createFolder.isPending || updateFolder.isPending}
        onConfirm={handleSubmitFolderName}
        onCancel={() => setFolderDialog(null)}
      />

      <ConfirmDialog
        isOpen={Boolean(deleteTarget)}
        title={t('folders.deleteTitle')}
        message={deleteTarget ? t('folders.deleteConfirm', { name: deleteTarget.name }) : ''}
        confirmText={t('folders.delete')}
        type="danger"
        isSubmitting={deleteFolder.isPending}
        onConfirm={handleConfirmDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  )
}

function getFolderDialogTitle(dialog: FolderDialogState, t: (key: string) => string) {
  if (!dialog) return ''
  if (dialog.mode === 'rename') return t('folders.editFolder')
  return dialog.parentId ? t('folders.newSubfolder') : t('folders.newFolder')
}

function getFolderDialogDescription(dialog: FolderDialogState, t: (key: string) => string) {
  if (!dialog) return ''
  if (dialog.mode === 'rename') return t('folders.editDescription')
  return dialog.parentId ? t('folders.subfolderDescription') : t('folders.createDescription')
}

function SystemFolder({
  icon,
  label,
  count,
  active,
  onClick,
}: {
  icon: ReactNode
  label: string
  count: number
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(`flex min-h-9 w-full items-center gap-2 rounded-lg px-2 py-2 text-sm transition-colors ${
        active ? 'bg-primary/10 text-primary' : 'text-foreground hover:bg-muted/60'
      }`)}
    >
      {icon}
      <span className="min-w-0 flex-1 truncate text-left">{label}</span>
      <CountBadge active={active} count={count} />
    </button>
  )
}

function CountBadge({ active, count }: { active: boolean; count: number }) {
  return (
    <span
      className={cn(`rounded-full px-2 py-0.5 text-[11px] ${
        active ? 'bg-primary/15 text-primary' : 'bg-muted text-muted-foreground'
      }`)}
    >
      {count}
    </span>
  )
}
