import { useState } from 'react'
import { cn } from '@/lib/utils'
import { useTranslation } from 'react-i18next'
import { Bookmark as BookmarkIcon, Archive, ArchiveRestore, Camera, CheckSquare, Clock3, Folder, FolderInput, Globe2, MoreVertical, Pencil, Pin, PinOff, Square } from 'lucide-react'
import type { BookmarkDTO } from '@tmarks/contracts'
import { recordBookmarkClick } from '@/hooks/useBookmarks'
import { safeHttpUrl, safeImageSrc } from '@/lib/safe-url'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { memo } from 'react'
import { Badge } from '@/components/ui/badge'
import { bookmarkRowPropsEqual } from './row-memo'
import { Checkbox } from '@/components/ui/checkbox'
import { formatBookmarkDate, getBookmarkDomain, getBookmarkFolderLabel, DENSITY_SPACING, type BookmarkDensity } from './bookmarkDisplay'
import { SnapshotViewerModal } from './SnapshotViewerModal'

interface BookmarkCardViewProps {
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
  /** 卡片网格密度(外观设置):列间距与卡片行距随之收紧/放宽。 */
  density?: BookmarkDensity
}

export function BookmarkCardView({
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
  density = 'normal',
}: BookmarkCardViewProps) {
  const spacing = DENSITY_SPACING[density]
  return (
    <div className={`columns-1 ${spacing.gap} sm:columns-2 md:columns-3 lg:columns-4 xl:columns-5`}>
      {bookmarks.map((bookmark) => (
        <div key={bookmark.id} className={`${spacing.margin} break-inside-avoid`}>
          <BookmarkCard
            bookmark={bookmark}
            onEdit={onEdit ? () => onEdit(bookmark) : undefined}
            onTogglePin={onTogglePin ? () => onTogglePin(bookmark) : undefined}
            onToggleTodo={onToggleTodo ? () => onToggleTodo(bookmark) : undefined}
            onToggleArchive={onToggleArchive ? () => onToggleArchive(bookmark) : undefined}
            onMove={onMove ? () => onMove(bookmark) : undefined}
            readOnly={readOnly}
            batchMode={batchMode}
            isSelected={selectedIds.includes(bookmark.id)}
            onToggleSelect={onToggleSelect}
          />
        </div>
      ))}
    </div>
  )
}

interface BookmarkCardProps {
  bookmark: BookmarkDTO
  onEdit?: () => void
  onTogglePin?: () => void
  onToggleTodo?: () => void
  onToggleArchive?: () => void
  onMove?: () => void
  readOnly?: boolean
  batchMode?: boolean
  isSelected?: boolean
  onToggleSelect?: (id: string) => void
}

const BookmarkCard = memo(function BookmarkCard({
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
}: BookmarkCardProps) {
  const { t, i18n } = useTranslation('bookmarks')
  // 按失败的 src 记录(而非一次性布尔):编辑书签换掉失效图片 URL、或后台
  // 持久化把失效 URL 改写为 /api/ 资产后,卡片应恢复显示新地址。
  const [brokenCover, setBrokenCover] = useState<string | null>(null)
  const [brokenFavicon, setBrokenFavicon] = useState<string | null>(null)
  const [showSnapshots, setShowSnapshots] = useState(false)
  const domain = getBookmarkDomain(bookmark.url)
  const folderLabel = getBookmarkFolderLabel(bookmark.folder_path, t('folders.uncategorized'))
  const updatedLabel = formatBookmarkDate(bookmark.updated_at, i18n.language)
  const coverSrc = safeImageSrc(bookmark.cover_image)
  const faviconSrc = safeImageSrc(bookmark.favicon)

  const handleVisit = () => {
    const href = safeHttpUrl(bookmark.url)
    if (!href) return
    if (!readOnly) recordBookmarkClick(bookmark.id)
    window.open(href, '_blank', 'noopener,noreferrer')
  }

  const handleCardClick = (event: React.MouseEvent) => {
    // Ignore clicks that originate from interactive elements (kebab menu trigger, checkbox, etc.)
    // Note: [role="checkbox"] is intentionally excluded — the card root itself carries
    // that role in batch mode, so including it here would swallow every body click.
    const target = event.target as HTMLElement
    if (target.closest('button, a, [role="menuitem"], input, select, textarea')) {
      return
    }
    if (batchMode && onToggleSelect) {
      event.preventDefault()
      onToggleSelect(bookmark.id)
    } else {
      handleVisit()
    }
  }

  return (
    <div
      className={cn(`group relative flex w-full min-w-0 flex-col overflow-hidden rounded-lg border border-border/70 bg-card/95 shadow-sm transition-all hover:-translate-y-0.5 hover:border-primary/25 hover:shadow-lg focus:outline-none focus:ring-2 focus:ring-ring ${
        batchMode ? 'cursor-default' : 'cursor-pointer'
      } ${batchMode && isSelected ? 'bookmark-selected-surface' : ''}`)}
      role={batchMode ? 'checkbox' : 'link'}
      aria-checked={batchMode ? isSelected : undefined}
      tabIndex={0}
      onClick={handleCardClick}
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
      {batchMode && onToggleSelect && (
        <div
          className="absolute left-2 top-2 z-10"
          onClick={(event) => event.stopPropagation()}
        >
          <Checkbox
            checked={isSelected}
            onCheckedChange={() => onToggleSelect(bookmark.id)}
            aria-label={t(isSelected ? 'batch.deselect' : 'batch.select')}
          />
        </div>
      )}
      {!readOnly && !batchMode && (onTogglePin || onToggleTodo || onToggleArchive || onMove || onEdit) && (
        <div className="absolute right-1.5 top-1.5 z-10 opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                onClick={(event) => event.stopPropagation()}
                className="flex h-6 w-6 items-center justify-center rounded-md bg-background/80 text-muted-foreground backdrop-blur-sm hover:bg-muted hover:text-foreground"
                aria-label={t('action.edit')}
              >
                <MoreVertical className="h-3.5 w-3.5" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-36">
              {onTogglePin && (
                <DropdownMenuItem onSelect={() => onTogglePin()}>
                  {bookmark.is_pinned ? <PinOff className="h-4 w-4" /> : <Pin className="h-4 w-4" />}
                  {bookmark.is_pinned ? t('action.unpin') : t('action.pin')}
                </DropdownMenuItem>
              )}
              {onToggleTodo && (
                <DropdownMenuItem onSelect={() => onToggleTodo()}>
                  {bookmark.is_todo ? <CheckSquare className="h-4 w-4" /> : <Square className="h-4 w-4" />}
                  {bookmark.is_todo ? t('action.unmarkTodo') : t('action.markTodo')}
                </DropdownMenuItem>
              )}
              {onToggleArchive && (
                <DropdownMenuItem onSelect={() => onToggleArchive()}>
                  {bookmark.is_archived ? <ArchiveRestore className="h-4 w-4" /> : <Archive className="h-4 w-4" />}
                  {bookmark.is_archived ? t('action.unarchive') : t('action.archive')}
                </DropdownMenuItem>
              )}
              {onMove && (
                <DropdownMenuItem onSelect={() => onMove()}>
                  <FolderInput className="h-4 w-4" />
                  {t('move.toFolder')}
                </DropdownMenuItem>
              )}
              {onEdit && (
                <DropdownMenuItem onSelect={() => onEdit()}>
                  <Pencil className="h-4 w-4" />
                  {t('action.edit')}
                </DropdownMenuItem>
              )}
              <DropdownMenuItem onSelect={() => setShowSnapshots(true)}>
                <Camera className="h-4 w-4" />
                {t('snapshots.menuLabel')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}

      <div className="flex h-20 flex-shrink-0 items-center justify-center overflow-hidden bg-gradient-to-br from-primary/5 to-primary/10">
        {coverSrc && coverSrc !== brokenCover ? (
          <img
            src={coverSrc}
            alt={bookmark.title}
            className="h-full w-full object-cover"
            loading="lazy"
            onError={() => setBrokenCover(coverSrc)}
          />
        ) : faviconSrc && faviconSrc !== brokenFavicon ? (
          <img
            src={faviconSrc}
            alt={bookmark.title}
            className="h-10 w-10 object-contain"
            loading="lazy"
            onError={() => setBrokenFavicon(faviconSrc)}
          />
        ) : (
          <BookmarkIcon className="h-8 w-8 text-muted-foreground/40" />
        )}
      </div>

      <div className="flex flex-col gap-1.5 p-2.5">
        <div className="flex flex-wrap gap-1">
          {bookmark.is_pinned && (
            <Badge variant="warning" className="w-fit">{t('status.pinned')}</Badge>
          )}
          {bookmark.is_todo && (
            <Badge variant="secondary" className="w-fit">{t('status.todo')}</Badge>
          )}
          {bookmark.is_archived && (
            <Badge variant="muted" className="w-fit">{t('status.archived')}</Badge>
          )}
        </div>
        <h3 className="line-clamp-2 text-xs font-semibold leading-snug">{bookmark.title}</h3>
        <div className="flex min-w-0 items-center gap-1.5 text-[10px] text-muted-foreground">
          <span className="flex min-w-0 items-center gap-1 truncate" title={bookmark.url}>
            <Globe2 className="h-2.5 w-2.5 flex-shrink-0" />
            <span className="truncate">{domain}</span>
          </span>
          {updatedLabel && (
            <span className="flex flex-shrink-0 items-center gap-0.5" title={bookmark.updated_at}>
              <Clock3 className="h-2.5 w-2.5" />
              {updatedLabel}
            </span>
          )}
        </div>
        <div className="flex min-w-0 items-center gap-1 text-[10px] text-muted-foreground" title={folderLabel}>
          <Folder className="h-2.5 w-2.5 flex-shrink-0" />
          <span className="truncate">{folderLabel}</span>
        </div>
        {bookmark.description && (
          <p className="line-clamp-2 text-[11px] leading-relaxed text-muted-foreground">{bookmark.description}</p>
        )}
        {bookmark.tags.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {bookmark.tags.map((tag) => (
              <Badge key={tag.id} variant="muted" className="text-[9px]">
                {tag.color && <span className="mr-1 inline-block h-1.5 w-1.5 rounded-full align-middle" style={{ backgroundColor: tag.color }} aria-hidden />}
                {tag.name}
              </Badge>
            ))}
          </div>
        )}
      </div>

      {showSnapshots && (
        <SnapshotViewerModal
          bookmarkId={bookmark.id}
          title={bookmark.title}
          isOpen={showSnapshots}
          onClose={() => setShowSnapshots(false)}
        />
      )}
    </div>
  )
}, bookmarkRowPropsEqual)
