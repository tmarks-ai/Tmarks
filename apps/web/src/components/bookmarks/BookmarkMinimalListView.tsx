import { useState } from 'react'
import { cn } from '@/lib/utils'
import { useTranslation } from 'react-i18next'
import { Archive, Bookmark as BookmarkIcon, CheckSquare, Clock3, Folder, FolderInput, GripVertical, Pencil, Pin, PinOff, Square } from 'lucide-react'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { BookmarkDTO } from '@tmarks/contracts'
import { recordBookmarkClick } from '@/hooks/useBookmarks'
import { safeHttpUrl, safeImageSrc } from '@/lib/safe-url'
import { memo } from 'react'
import { Badge } from '@/components/ui/badge'
import { bookmarkRowPropsEqual } from './row-memo'
import { Checkbox } from '@/components/ui/checkbox'
import type { ItemDropPosition } from './useBookmarkDragAndDrop'
import { formatBookmarkDate, getBookmarkDomain, getBookmarkFolderLabel } from './bookmarkDisplay'

interface BookmarkMinimalListViewProps {
  bookmarks: BookmarkDTO[]
  onEdit?: (bookmark: BookmarkDTO) => void
  onTogglePin?: (bookmark: BookmarkDTO) => void
  onToggleTodo?: (bookmark: BookmarkDTO) => void
  onToggleArchive?: (bookmark: BookmarkDTO) => void
  onMove?: (bookmark: BookmarkDTO) => void
  readOnly?: boolean
  batchMode?: boolean
  selectedIds?: string[]
  onToggleSelect?: (id: string) => void
  sortable?: boolean
  overId?: string | null
  dropPosition?: ItemDropPosition | null
}

export function BookmarkMinimalListView({
  bookmarks,
  onEdit,
  onTogglePin,
  onToggleTodo,
  onToggleArchive,
  onMove,
  readOnly = false,
  batchMode = false,
  selectedIds = [],
  onToggleSelect,
  sortable = false,
  overId,
  dropPosition,
}: BookmarkMinimalListViewProps) {
  return (
    <div className="divide-y divide-border/60 overflow-hidden rounded-xl border border-border/60 bg-card/95">
      {bookmarks.map((bookmark) => (
        <BookmarkRow
          key={bookmark.id}
          bookmark={bookmark}
          onEdit={onEdit}
          onTogglePin={onTogglePin}
          onToggleTodo={onToggleTodo}
          onToggleArchive={onToggleArchive}
          onMove={onMove}
          readOnly={readOnly}
          batchMode={batchMode}
          isSelected={selectedIds.includes(bookmark.id)}
          onToggleSelect={onToggleSelect}
          sortable={sortable}
          overId={overId}
          dropPosition={dropPosition}
        />
      ))}
    </div>
  )
}

interface BookmarkRowProps {
  bookmark: BookmarkDTO
  onEdit?: (bookmark: BookmarkDTO) => void
  onTogglePin?: (bookmark: BookmarkDTO) => void
  onToggleTodo?: (bookmark: BookmarkDTO) => void
  onToggleArchive?: (bookmark: BookmarkDTO) => void
  onMove?: (bookmark: BookmarkDTO) => void
  readOnly?: boolean
  batchMode?: boolean
  isSelected?: boolean
  onToggleSelect?: (id: string) => void
  sortable?: boolean
  overId?: string | null
  dropPosition?: ItemDropPosition | null
}

const BookmarkRow = memo(function BookmarkRow({
  bookmark,
  onEdit,
  onTogglePin,
  onToggleTodo,
  onToggleArchive,
  onMove,
  readOnly = false,
  batchMode = false,
  isSelected = false,
  onToggleSelect,
  sortable = false,
  overId,
  dropPosition,
}: BookmarkRowProps) {
  const { t, i18n } = useTranslation('bookmarks')
  // 按失败的 src 记录(而非一次性布尔):favicon 换 URL 后恢复显示。
  const [brokenFavicon, setBrokenFavicon] = useState<string | null>(null)
  const domain = getBookmarkDomain(bookmark.url)
  // favicon 是入库的自由字符串(服务端只截断不校验协议),img src 须经
  // safeHttpUrl 与其他渲染路径一致,防止未来列复用到 href/CSS 时直通。
  const faviconSrc = safeImageSrc(bookmark.favicon)
  const folderLabel = getBookmarkFolderLabel(bookmark.folder_path, t('folders.uncategorized'))
  const updatedLabel = formatBookmarkDate(bookmark.updated_at, i18n.language)
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: bookmark.id,
    disabled: !sortable || batchMode,
  })
  const isOver = overId === bookmark.id
  const indicatorClass = isOver && dropPosition === 'before' ? 'border-t-2 border-primary'
    : isOver && dropPosition === 'after' ? 'border-b-2 border-primary'
    : ''

  const handleVisit = () => {
    const href = safeHttpUrl(bookmark.url)
    if (!href) return
    if (!readOnly) recordBookmarkClick(bookmark.id)
    window.open(href, '_blank', 'noopener,noreferrer')
  }

  const handleRowClick = (event: React.MouseEvent) => {
    if (batchMode && onToggleSelect) {
      event.preventDefault()
      onToggleSelect(bookmark.id)
    } else {
      handleVisit()
    }
  }

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(`group flex items-center gap-3 px-3 py-2.5 transition-colors hover:bg-muted/40 ${
        batchMode ? 'cursor-default' : 'cursor-pointer'
      } ${batchMode && isSelected ? 'bg-primary/10' : ''} ${indicatorClass} ${isDragging ? 'opacity-50' : ''}`)}
      onClick={handleRowClick}
      role={batchMode ? 'checkbox' : 'link'}
      aria-checked={batchMode ? isSelected : undefined}
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) return
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          if (batchMode && onToggleSelect) onToggleSelect(bookmark.id)
          else handleVisit()
        }
      }}
      aria-label={batchMode
        ? t(isSelected ? 'batch.deselect' : 'batch.select')
        : t('action.open', { title: bookmark.title })}
    >
      {batchMode && onToggleSelect ? (
        <div onClick={(event) => event.stopPropagation()}>
          <Checkbox
            checked={isSelected}
            onCheckedChange={() => onToggleSelect(bookmark.id)}
            aria-label={t(isSelected ? 'batch.deselect' : 'batch.select')}
          />
        </div>
      ) : sortable ? (
        <button
          type="button"
          className="flex h-8 w-8 flex-shrink-0 cursor-grab items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground active:cursor-grabbing"
          {...attributes}
          {...listeners}
          onClick={(event) => event.stopPropagation()}
          aria-label={t('action.dragHandle')}
        >
          <GripVertical className="h-4 w-4" />
        </button>
      ) : null}
      {faviconSrc && faviconSrc !== brokenFavicon ? (
        <img
          src={faviconSrc}
          alt=""
          className="h-5 w-5 flex-shrink-0"
          loading="lazy"
          onError={() => setBrokenFavicon(faviconSrc ?? null)}
        />
      ) : (
        <BookmarkIcon className="h-5 w-5 flex-shrink-0 text-muted-foreground/40" />
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          {bookmark.is_pinned && <Pin className="h-3 w-3 flex-shrink-0 text-warning" />}
          {bookmark.is_todo && <CheckSquare className="h-3 w-3 flex-shrink-0 text-primary" />}
          {bookmark.is_archived && <Archive className="h-3 w-3 flex-shrink-0 text-muted-foreground" />}
          <span className="truncate text-sm font-medium">{bookmark.title}</span>
        </div>
        <div className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
          <span className="min-w-0 truncate" title={bookmark.url}>{bookmark.url}</span>
          <span className="hidden min-w-0 items-center gap-1 truncate md:flex" title={folderLabel}>
            <Folder className="h-3 w-3 flex-shrink-0" />
            <span className="truncate">{folderLabel}</span>
          </span>
          {updatedLabel && (
            <span className="hidden flex-shrink-0 items-center gap-1 lg:flex" title={bookmark.updated_at}>
              <Clock3 className="h-3 w-3" />
              {updatedLabel}
            </span>
          )}
        </div>
        <span className="sr-only">{domain}</span>
      </div>
      {bookmark.tags.length > 0 && (
        <div className="hidden gap-1 sm:flex">
          {bookmark.tags.slice(0, 3).map((tag) => (
            <Badge key={tag.id} variant="muted" className="text-[10px]">
              {tag.color && <span className="mr-1 inline-block h-1.5 w-1.5 rounded-full align-middle" style={{ backgroundColor: tag.color }} aria-hidden />}
              {tag.name}
            </Badge>
          ))}
        </div>
      )}
      {!readOnly && !batchMode && (onTogglePin || onToggleTodo || onToggleArchive || onMove || onEdit) && (
        <div className="flex flex-shrink-0 items-center gap-0.5 opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100">
          {onToggleTodo && (
            <button
              type="button"
              onClick={(event) => { event.stopPropagation(); onToggleTodo(bookmark) }}
              aria-label={bookmark.is_todo ? t('action.unmarkTodo') : t('action.markTodo')}
              className={cn(`rounded p-1.5 hover:bg-muted ${bookmark.is_todo ? 'text-primary' : 'text-muted-foreground'}`)}
            >
              {bookmark.is_todo ? <CheckSquare className="h-4 w-4" /> : <Square className="h-4 w-4" />}
            </button>
          )}
          {onToggleArchive && (
            <button
              type="button"
              onClick={(event) => { event.stopPropagation(); onToggleArchive(bookmark) }}
              aria-label={bookmark.is_archived ? t('action.unarchive') : t('action.archive')}
              className={cn(`rounded p-1.5 hover:bg-muted ${bookmark.is_archived ? 'text-primary' : 'text-muted-foreground'}`)}
            >
              <Archive className="h-4 w-4" />
            </button>
          )}
          {onTogglePin && (
            <button
              type="button"
              onClick={(event) => { event.stopPropagation(); onTogglePin(bookmark) }}
              aria-label={bookmark.is_pinned ? t('action.unpin') : t('action.pin')}
              className={cn(`rounded p-1.5 hover:bg-muted ${bookmark.is_pinned ? 'text-warning' : 'text-muted-foreground'}`)}
            >
              {bookmark.is_pinned ? <PinOff className="h-4 w-4" /> : <Pin className="h-4 w-4" />}
            </button>
          )}
          {onMove && (
            <button
              type="button"
              onClick={(event) => { event.stopPropagation(); onMove(bookmark) }}
              aria-label={t('move.toFolder')}
              className="rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-primary"
            >
              <FolderInput className="h-4 w-4" />
            </button>
          )}
          {onEdit && (
            <button
              type="button"
              onClick={(event) => { event.stopPropagation(); onEdit(bookmark) }}
              aria-label={t('action.edit')}
              className="rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-primary"
            >
              <Pencil className="h-4 w-4" />
            </button>
          )}
        </div>
      )}
    </div>
  )
}, bookmarkRowPropsEqual)
