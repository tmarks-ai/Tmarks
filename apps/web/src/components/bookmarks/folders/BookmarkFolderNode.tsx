import { useState } from 'react'
import { cn } from '@/lib/utils'
import { ChevronRight, Folder, FolderInput, FolderOpen, GripVertical, MoreVertical, Pencil, Plus, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { BookmarkFolderDTO } from '@tmarks/contracts'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { getFolderTotalCount } from './folderTree'
import type { FolderDropPosition } from './useBookmarkFolderDragAndDrop'

interface BookmarkFolderNodeProps {
  folder: BookmarkFolderDTO
  selectedId: string
  readOnly?: boolean
  depth?: number
  onSelect: (folderId: string) => void
  onCreateChild: (parentId: string) => void
  onRename: (folder: BookmarkFolderDTO) => void
  onDelete: (folder: BookmarkFolderDTO) => void
  onMove?: (folder: BookmarkFolderDTO) => void
  overId?: string | null
  dropPosition?: FolderDropPosition | null
}

/** 文件夹树节点(递归)。useSortable 拖拽 + drag handle + before/inside/after 指示器;仅一级目录可建子目录;操作菜单用 Radix DropdownMenu。 */
export function BookmarkFolderNode({
  folder,
  selectedId,
  readOnly,
  depth = 0,
  onSelect,
  onCreateChild,
  onRename,
  onDelete,
  onMove,
  overId,
  dropPosition,
}: BookmarkFolderNodeProps) {
  const { t } = useTranslation('bookmarks')
  const selected = selectedId === folder.id
  const children = folder.children ?? []
  const [expanded, setExpanded] = useState(true)
  const Icon = selected ? FolderOpen : Folder
  const rowWeight = depth === 0 ? 'font-medium' : 'text-[13px]'
  const bookmarkCount = getFolderTotalCount(folder)
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: folder.id,
    disabled: readOnly,
  })

  const isOver = overId === folder.id
  const indicator = isOver && dropPosition === 'before' ? 'before'
    : isOver && dropPosition === 'after' ? 'after'
    : isOver && dropPosition === 'inside' ? 'inside'
    : ''
  const indicatorClass = indicator === 'before' ? 'border-t-2 border-primary'
    : indicator === 'after' ? 'border-b-2 border-primary'
    : indicator === 'inside' ? 'ring-2 ring-primary bg-primary/5'
    : ''

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(`space-y-1 ${isDragging ? 'opacity-50' : ''}`)}
    >
      <div
        className={cn(`group relative flex min-h-9 w-full min-w-0 items-center gap-2 overflow-hidden rounded-lg border-transparent px-2 py-2 text-sm transition-colors ${rowWeight} ${selected ? 'bg-primary/10 text-primary' : 'text-foreground hover:bg-muted/60'} ${indicatorClass}`)}
      >
        {children.length > 0 ? (
          <button
            type="button"
            onClick={() => setExpanded((value) => !value)}
            className="flex h-4 w-4 flex-shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-muted"
            aria-label={expanded ? t('folders.collapse') : t('folders.expand')}
          >
            <ChevronRight className={cn(`h-3.5 w-3.5 transition-transform ${expanded ? 'rotate-90' : ''}`)} />
          </button>
        ) : (
          <span className={cn(`${depth === 0 ? 'w-4' : 'w-1'} flex-shrink-0`)} />
        )}
        <button
          type="button"
          onClick={() => onSelect(folder.id)}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
        >
          <Icon className="h-4 w-4 flex-shrink-0" />
          <span className="truncate">{folder.name}</span>
          <span
            className={cn(`ml-auto rounded-full px-2 py-0.5 text-[11px] ${
              selected ? 'bg-primary/15 text-primary' : 'bg-muted text-muted-foreground'
            }`)}
          >
            {bookmarkCount}
          </span>
        </button>
        {!readOnly && (
          <div className="pointer-events-auto absolute right-2 top-1/2 z-10 flex -translate-y-1/2 items-center gap-0.5 opacity-100 transition-opacity sm:pointer-events-none sm:opacity-0 sm:group-hover:pointer-events-auto sm:group-hover:opacity-100 sm:focus-within:pointer-events-auto sm:focus-within:opacity-100">
            <button
              type="button"
              className="flex h-6 w-6 cursor-grab items-center justify-center rounded-md text-muted-foreground hover:bg-muted active:cursor-grabbing"
              {...attributes}
              {...listeners}
              onClick={(e) => e.stopPropagation()}
              aria-label={t('folders.dragHandle')}
            >
              <GripVertical className="h-3.5 w-3.5" />
            </button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className="rounded-md border border-border/70 bg-card/95 p-1 text-muted-foreground shadow-sm backdrop-blur transition-colors hover:bg-muted hover:text-foreground"
                  aria-label={t('folders.more')}
                >
                  <MoreVertical className="h-3.5 w-3.5" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-32">
                {depth === 0 && (
                  <DropdownMenuItem onClick={() => onCreateChild(folder.id)}>
                    <Plus className="h-4 w-4" />
                    {t('folders.createChild')}
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem onClick={() => onMove?.(folder)}>
                  <FolderInput className="h-4 w-4" />
                  {t('folders.move')}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => onRename(folder)}>
                  <Pencil className="h-4 w-4" />
                  {t('folders.rename')}
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="text-destructive focus:text-destructive"
                  onClick={() => onDelete(folder)}
                >
                  <Trash2 className="h-4 w-4" />
                  {t('folders.delete')}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}
      </div>

      {expanded && children.length > 0 && (
        <div className="ml-3 border-l border-border/35 pl-1">
          {children.map((child) => (
            <BookmarkFolderNode
              key={child.id}
              folder={child}
              selectedId={selectedId}
              readOnly={readOnly}
              depth={depth + 1}
              onSelect={onSelect}
              onCreateChild={onCreateChild}
              onRename={onRename}
              onDelete={onDelete}
              onMove={onMove}
              overId={overId}
              dropPosition={dropPosition}
            />
          ))}
        </div>
      )}
    </div>
  )
}
