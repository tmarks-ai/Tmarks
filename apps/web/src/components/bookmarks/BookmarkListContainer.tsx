import { useTranslation } from 'react-i18next'
import { FilterX, Search } from 'lucide-react'
import { DndContext, DragOverlay } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import type { BookmarkDTO, ReorderBookmarkItem } from '@tmarks/contracts'
import { BookmarkCardView } from './BookmarkCardView'
import { BookmarkMinimalListView } from './BookmarkMinimalListView'
import { EmptyState } from '@/components/common/EmptyState'
import { Button } from '@/components/ui/button'
import { useBookmarkDragAndDrop } from './useBookmarkDragAndDrop'
import type { ViewMode } from '@/lib/constants/bookmarks'

interface BookmarkListContainerProps {
  bookmarks: BookmarkDTO[]
  isLoading?: boolean
  viewMode?: ViewMode
  density?: 'compact' | 'normal' | 'comfortable' 
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
  onReorder?: (updates: ReorderBookmarkItem[]) => void
  isFiltering?: boolean
  onClearFilters?: () => void
}

export function BookmarkListContainer({
  bookmarks,
  isLoading,
  viewMode = 'card',
  density,
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
  onReorder,
  isFiltering = false,
  onClearFilters,
}: BookmarkListContainerProps) {
  const { t } = useTranslation('bookmarks')
  const dnd = useBookmarkDragAndDrop({ bookmarks, onReorder: onReorder ?? (() => {}) })

  if (isLoading && bookmarks.length === 0) {
    if (viewMode === 'minimal') {
      return (
        <div className="divide-y divide-border/60 overflow-hidden rounded-xl border border-border/60 bg-card/95">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex animate-pulse items-center gap-3 px-3 py-2.5">
              <div className="h-5 w-5 flex-shrink-0 rounded bg-muted/50" />
              <div className="flex-1 space-y-1.5">
                <div className="h-3.5 w-1/2 rounded bg-muted/50" />
                <div className="h-3 w-3/4 rounded bg-muted/40" />
              </div>
            </div>
          ))}
        </div>
      )
    }
    return (
      <div className="columns-1 gap-3 sm:columns-2 md:columns-3 lg:columns-4 xl:columns-5">
        {Array.from({ length: 10 }).map((_, i) => (
          <div key={i} className="mb-3 break-inside-avoid animate-pulse overflow-hidden rounded-lg border border-border/60 bg-card/95">
            <div className="h-20 bg-muted/40" />
            <div className="space-y-1.5 p-2.5">
              <div className="h-3 w-3/4 rounded bg-muted/50" />
              <div className="h-2.5 w-full rounded bg-muted/40" />
              <div className="h-2.5 w-2/3 rounded bg-muted/40" />
            </div>
          </div>
        ))}
      </div>
    )
  }

  if (bookmarks.length === 0) {
    const showClearFilters = isFiltering && !readOnly && typeof onClearFilters === 'function'
    return (
      <EmptyState
        icon={showClearFilters ? FilterX : Search}
        title={showClearFilters ? t('search.noResults') : t('empty.title')}
        description={showClearFilters ? t('empty.hint') : readOnly ? t('empty.readOnlyDescription') : t('empty.description')}
        className="rounded-xl border border-border/60 bg-card/95 py-16 shadow-sm"
        action={
          showClearFilters ? (
            <Button variant="outline" size="sm" onClick={onClearFilters}>
              {t('batch.emptyFilteredAction')}
            </Button>
          ) : undefined
        }
      />
    )
  }

  const rowProps = {
    bookmarks,
    onEdit,
    onTogglePin,
    onToggleTodo,
    onToggleArchive,
    onMove,
    readOnly,
    batchMode,
    selectedIds,
    onToggleSelect,
  }

  if (viewMode === 'minimal') {
    return sortable && onReorder ? (
      <DndContext {...dnd.dndContextProps}>
        <SortableContext items={bookmarks.map((b) => b.id)} strategy={verticalListSortingStrategy}>
          <BookmarkMinimalListView {...rowProps} sortable overId={dnd.overId} dropPosition={dnd.dropPosition} />
        </SortableContext>
        <DragOverlay>
          {dnd.activeBookmark ? (
            <div className="flex items-center gap-2 rounded-lg bg-card px-3 py-2 shadow-lg">
              <span className="truncate text-sm font-medium">{dnd.activeBookmark.title}</span>
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>
    ) : (
      <BookmarkMinimalListView {...rowProps} />
    )
  }

  return <BookmarkCardView {...rowProps} density={density} />
}
