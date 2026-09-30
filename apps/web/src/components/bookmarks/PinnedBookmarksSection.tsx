import { useState } from 'react'
import { cn } from '@/lib/utils'
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import { SortableContext, arrayMove, useSortable, horizontalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { ExternalLink, Pin, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { BookmarkDTO } from '@tmarks/contracts'
import { useReorderPinned, recordBookmarkClick } from '@/hooks/useBookmarks'
import { useToastStore } from '@/stores/toastStore'
import { Hint } from '@/components/ui/tooltip'
import { ConfirmDialog } from '@/components/common/ConfirmDialog'
import { safeHttpUrl, safeImageSrc } from '@/lib/safe-url'

interface PinnedBookmarksSectionProps {
  bookmarks: BookmarkDTO[]
  onUnpin?: (bookmark: BookmarkDTO) => void
  i18nNs?: string
}

/** 置顶 Dock:仿 macOS Dock 横向图标条。点击左侧 📌 进入编辑模式,图标上出现 × 删除按钮(带确认框)。 */
export function PinnedBookmarksSection({
  bookmarks,
  onUnpin,
  i18nNs = 'bookmarks',
}: PinnedBookmarksSectionProps) {
  const { t } = useTranslation(i18nNs)
  const toast = useToastStore.getState()
  const reorderPinned = useReorderPinned()
  const [editMode, setEditMode] = useState(false)
  const [unpinTarget, setUnpinTarget] = useState<BookmarkDTO | null>(null)
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor),
  )
  if (bookmarks.length === 0) return null

  const handleDragEnd = (event: DragEndEvent) => {
    if (editMode) return
    const { active, over } = event
    if (!over || active.id === over.id) return
    const fromIndex = bookmarks.findIndex((b) => b.id === active.id)
    const toIndex = bookmarks.findIndex((b) => b.id === over.id)
    if (fromIndex === -1 || toIndex === -1) return
    const next = arrayMove(bookmarks, fromIndex, toIndex)
    reorderPinned.mutate(
      { bookmark_ids: next.map((b) => b.id) },
      { onSuccess: () => toast.success(t('action.reorderSuccess')) },
    )
  }

  return (
    <section className="mb-4">
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={bookmarks.map((b) => b.id)} strategy={horizontalListSortingStrategy}>
          <div className="flex items-center gap-1.5 rounded-2xl border border-border/40 bg-card/50 p-2 shadow-sm backdrop-blur-xl">
            <button
              type="button"
              onClick={() => setEditMode((v) => !v)}
              className={cn(`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg transition-colors hover:bg-muted/50 ${editMode ? 'bg-primary/10' : ''}`)}
              aria-label={t('status.editPinned')}
              aria-pressed={editMode}
            >
              <Pin className={cn(`h-5 w-5 transition-colors ${editMode ? 'text-primary' : 'text-amber-500'}`)} />
            </button>
            {bookmarks.length > 0 && <div className="h-8 w-px flex-shrink-0 bg-border/30" />}
            <div className="flex flex-wrap items-center gap-2">
              {bookmarks.map((bookmark) => (
                <DockIcon
                  key={bookmark.id}
                  bookmark={bookmark}
                  editMode={editMode}
                  onUnpinClick={() => setUnpinTarget(bookmark)}
                  i18nNs={i18nNs}
                />
              ))}
            </div>
          </div>
        </SortableContext>
      </DndContext>
      <ConfirmDialog
        isOpen={Boolean(unpinTarget)}
        title={t('action.unpin')}
        message={t('action.unpinConfirm', { title: unpinTarget?.title ?? '' })}
        confirmText={t('action.unpin')}
        type="default"
        onConfirm={() => {
          if (unpinTarget) onUnpin?.(unpinTarget)
          setUnpinTarget(null)
        }}
        onCancel={() => setUnpinTarget(null)}
      />
    </section>
  )
}

interface DockIconProps {
  bookmark: BookmarkDTO
  editMode: boolean
  onUnpinClick: () => void
  i18nNs: string
}

function DockIcon({ bookmark, editMode, onUnpinClick, i18nNs }: DockIconProps) {
  const { t } = useTranslation(i18nNs)
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: bookmark.id })
  // 按失败的 src 记录(而非布尔):favicon 换 URL 后恢复显示,新地址再失败才重新隐藏。
  const [brokenSrc, setBrokenSrc] = useState<string | null>(null)
  const href = safeHttpUrl(bookmark.url)
  // 与列表/回收站一致:safeImageSrc 额外放行 R2 持久化后的 /api/ 资产路径。
  const faviconSrc = safeImageSrc(bookmark.favicon)
  const showFallback = !faviconSrc || faviconSrc === brokenSrc

  const handleClick = () => {
    if (editMode) return
    if (href) {
      // 置顶 Dock 是最高频入口,却曾是唯一点击不上报的书签交互面。
      recordBookmarkClick(bookmark.id)
      window.open(href, '_blank', 'noopener,noreferrer')
    }
  }

  // 键盘可达:编辑模式下 dnd 的 KeyboardSensor 接管按键,此时按 Enter/Space
  // 是拖拽不是打开;非编辑模式必须自己响应,否则键盘用户无法打开置顶书签。
  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (editMode) return
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      handleClick()
    }
  }

  return (
    <Hint label={bookmark.title} side="top">
      <div
        ref={setNodeRef}
        role="button"
        tabIndex={0}
        aria-label={bookmark.title}
        style={{ transform: CSS.Transform.toString(transform), transition }}
        className={cn(`group relative flex h-12 w-12 flex-shrink-0 cursor-pointer touch-none items-center justify-center rounded-xl border bg-card/60 transition-all hover:scale-110 hover:bg-card/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 ${
          editMode ? 'border-primary/40 ring-2 ring-primary/20' : 'border-border/40 hover:border-primary/30'
        } ${isDragging ? 'opacity-50' : ''}`)}
        onClick={handleClick}
        onKeyDown={handleKeyDown}
        {...(editMode ? {} : { ...attributes, ...listeners })}
      >
        {showFallback ? (
          <ExternalLink className="h-7 w-7 text-muted-foreground" />
        ) : (
          <img
            src={faviconSrc}
            alt={bookmark.title}
            className="h-8 w-8 rounded object-contain"
            loading="lazy"
            onError={() => setBrokenSrc(faviconSrc ?? null)}
          />
        )}
        {editMode && (
          <button
            type="button"
            onClick={(event) => {
              event.preventDefault()
              event.stopPropagation()
              onUnpinClick()
            }}
            className="absolute -right-1.5 -top-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-destructive text-destructive-foreground shadow-md ring-2 ring-background"
            aria-label={t('action.unpin')}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    </Hint>
  )
}
