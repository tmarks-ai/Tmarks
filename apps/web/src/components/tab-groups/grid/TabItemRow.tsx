import { Archive, ArchiveRestore, CheckSquare, ExternalLink, GripVertical, Lock, MoreVertical, MoveHorizontal, Pencil, Pin, Trash2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useTranslation } from 'react-i18next'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { TabGroupItemDTO } from '@tmarks/contracts'
import { Checkbox } from '@/components/ui/checkbox'
import { Hint } from '@/components/ui/tooltip'
import { safeHttpUrl } from '@/lib/safe-url'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import type { ItemDropPosition } from './useItemDragAndDrop'

const GLOBE_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="%239ca3af" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>'

function faviconSrc(item: TabGroupItemDTO): string {
  const stored = safeHttpUrl(item.favicon)
  if (stored) return stored
  try {
    const parsed = new URL(item.url)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return ''
    return `https://www.google.com/s2/favicons?domain=${parsed.hostname}&sz=32`
  } catch {
    return ''
  }
}

interface TabItemRowProps {
  item: TabGroupItemDTO
  groupId: string
  groupLocked?: boolean
  onEdit: (item: TabGroupItemDTO) => void
  onDelete: (item: TabGroupItemDTO) => void
  onTogglePin?: (item: TabGroupItemDTO) => void
  onToggleTodo?: (item: TabGroupItemDTO) => void
  onToggleArchive?: (item: TabGroupItemDTO) => void
  onMoveItem?: (item: TabGroupItemDTO) => void
  batchMode?: boolean
  selected?: boolean
  onToggleSelect?: (id: string) => void
  overId?: string | null
  dropPosition?: ItemDropPosition | null
  i18nNs?: string
}

const ICON_BTN = 'flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground'

/** 单个标签页条目行:useSortable 拖拽 + drag handle(批量模式切换 Checkbox)+ before/after 指示器 + favicon/标题(徽标)/URL + 打开/固定/待办/移动/编辑/删除操作。条目或组锁定时禁用拖拽与编辑类操作。 */
export function TabItemRow({
  item,
  groupId,
  groupLocked,
  onEdit,
  onDelete,
  onTogglePin,
  onToggleTodo,
  onToggleArchive,
  onMoveItem,
  batchMode,
  selected,
  onToggleSelect,
  overId,
  dropPosition,
  i18nNs = 'tabGroups',
}: TabItemRowProps) {
  const { t } = useTranslation(i18nNs)
  const locked = !!item.is_locked || !!groupLocked
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: item.id,
    data: { type: 'item', groupId },
    disabled: batchMode || locked,
  })
  const isOver = overId === item.id
  const href = safeHttpUrl(item.url)
  const indicatorClass = isOver && dropPosition === 'before' ? 'border-t-2 border-primary'
    : isOver && dropPosition === 'after' ? 'border-b-2 border-primary'
    : ''
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(`group flex items-center gap-3 rounded-xl px-2 py-2 hover:bg-muted/50 ${selected ? 'bg-primary/10' : ''} ${indicatorClass} ${isDragging ? 'opacity-50' : ''} ${item.is_archived ? 'opacity-60' : ''}`)}
    >
      {batchMode ? (
        <Checkbox
          checked={selected}
          onCheckedChange={() => onToggleSelect?.(item.id)}
          aria-label={t(selected ? 'item.deselect' : 'item.select')}
        />
      ) : (
        <button
          type="button"
          className="flex h-8 w-8 flex-shrink-0 cursor-grab items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground active:cursor-grabbing"
          {...attributes}
          {...listeners}
          aria-label={t('menu.move')}
        >
          <GripVertical className="h-4 w-4" />
        </button>
      )}
      <img
        src={faviconSrc(item)}
        alt=""
        className="h-5 w-5 flex-shrink-0 rounded"
        onError={(event) => {
          const img = event.currentTarget
          if (!img.dataset.fallback) {
            img.dataset.fallback = '1'
            img.src = `data:image/svg+xml,${encodeURIComponent(GLOBE_SVG)}`
          }
        }}
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          {href ? (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="truncate text-sm font-medium text-foreground hover:text-primary"
              title={item.title}
            >
              {item.title}
            </a>
          ) : (
            <span className="truncate text-sm font-medium text-foreground" title={item.title}>
              {item.title}
            </span>
          )}
          {item.is_pinned && <Pin className="h-3 w-3 flex-shrink-0 text-amber-500" aria-label={t('item.pinned')} />}
          {item.is_todo && <CheckSquare className="h-3 w-3 flex-shrink-0 text-primary" aria-label={t('item.todo')} />}
          {item.is_archived && <Archive className="h-3 w-3 flex-shrink-0 text-muted-foreground" aria-label={t('item.archived')} />}
          {locked && <Lock className="h-3 w-3 flex-shrink-0 text-muted-foreground" aria-label={t('item.locked')} />}
        </div>
        <p className="truncate text-xs text-muted-foreground">{item.url}</p>
      </div>
      {!batchMode && (
        <div className="flex flex-shrink-0 items-center gap-1 sm:opacity-0 sm:transition-opacity sm:group-hover:opacity-100 sm:focus-within:opacity-100">
          <Hint label={t('menu.openLink')}>
            {href ? (
              <a
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                className={ICON_BTN}
                aria-label={t('menu.openLink')}
              >
                <ExternalLink className="h-4 w-4" />
              </a>
            ) : (
              <span className={cn(`${ICON_BTN} cursor-not-allowed opacity-50`)} aria-label={t('menu.openLink')}>
                <ExternalLink className="h-4 w-4" />
              </span>
            )}
          </Hint>
          {!locked && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className={ICON_BTN}
                  aria-label={t('tree.moreActions')}
                >
                  <MoreVertical className="h-4 w-4" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {onTogglePin && (
                  <DropdownMenuItem onSelect={() => onTogglePin(item)}>
                    <Pin className="h-4 w-4" />
                    {item.is_pinned ? t('menu.unpin') : t('menu.pin')}
                  </DropdownMenuItem>
                )}
                {onToggleTodo && (
                  <DropdownMenuItem onSelect={() => onToggleTodo(item)}>
                    <CheckSquare className="h-4 w-4" />
                    {item.is_todo ? t('menu.unmarkTodo') : t('menu.markTodo')}
                  </DropdownMenuItem>
                )}
                {onToggleArchive && (
                  <DropdownMenuItem onSelect={() => onToggleArchive(item)}>
                    {item.is_archived ? <ArchiveRestore className="h-4 w-4" /> : <Archive className="h-4 w-4" />}
                    {item.is_archived ? t('menu.unarchive') : t('menu.archive')}
                  </DropdownMenuItem>
                )}
                {onMoveItem && (
                  <DropdownMenuItem onSelect={() => onMoveItem(item)}>
                    <MoveHorizontal className="h-4 w-4" />
                    {t('menu.moveToOtherGroup')}
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem onSelect={() => onEdit(item)}>
                  <Pencil className="h-4 w-4" />
                  {t('item.edit')}
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => onDelete(item)} className="text-destructive">
                  <Trash2 className="h-4 w-4" />
                  {t('item.delete')}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      )}
    </div>
  )
}
