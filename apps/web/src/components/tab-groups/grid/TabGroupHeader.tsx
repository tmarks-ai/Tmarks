import { Link } from 'react-router-dom'
import { CopyX, FolderInput, FolderOpen, Lock, LockOpen, MoreVertical, Palette, Pencil, Plus, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { TabGroupDTO } from '@tmarks/contracts'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

interface TabGroupHeaderProps {
  group: TabGroupDTO
  onEdit: (group: TabGroupDTO) => void
  onDelete: (group: TabGroupDTO) => void
  onAddItems: (group: TabGroupDTO) => void
  onOpenAll: (group: TabGroupDTO) => void
  onMoveGroup?: (group: TabGroupDTO) => void
  onColorTag?: (group: TabGroupDTO) => void
  onToggleLock?: (group: TabGroupDTO) => void
  onDedup?: (group: TabGroupDTO) => void
  isDeleting?: boolean
  i18nNs?: string
}

/** 组卡片头:色点+标题 + 标签页计数 + 标签徽标 + 添加/打开全部/移动/颜色标签/分享/锁定/去重/编辑/删除(桌面 inline,移动 DropdownMenu)。 */
export function TabGroupHeader({
  group,
  onEdit,
  onDelete,
  onAddItems,
  onOpenAll,
  onMoveGroup,
  onColorTag,
  onToggleLock,
  onDedup,
  isDeleting,
  i18nNs = 'tabGroups',
}: TabGroupHeaderProps) {
  const { t } = useTranslation(i18nNs)
  const itemCount = group.items?.length ?? group.item_count ?? 0
  const iconBtn = 'h-8 w-8'
  const tags = group.tags ?? []
  return (
    <header className="flex items-center gap-2 border-b border-border/60 px-3 py-2.5">
      <h3 className="flex flex-1 items-center gap-1.5 truncate text-sm font-semibold text-foreground">
        {group.color && <span className="h-2.5 w-2.5 flex-shrink-0 rounded-full" style={{ backgroundColor: group.color }} />}
        <Link to={`/tab/${group.id}`} className="truncate text-foreground hover:text-primary hover:underline" title={group.title}>
          {group.title}
        </Link>
        {group.is_locked && <Lock className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" aria-label={t('item.locked')} />}
      </h3>
      <span className="text-xs text-muted-foreground">{t('header.tabCount', { count: itemCount })}</span>
      {tags.length > 0 && (
        <div className="hidden items-center gap-1 lg:flex">
          {tags.slice(0, 3).map((tag) => (
            <span key={tag} className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">{tag}</span>
          ))}
          {tags.length > 3 && <span className="text-[10px] text-muted-foreground">+{tags.length - 3}</span>}
        </div>
      )}
      <div className="flex items-center gap-1">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className={iconBtn} aria-label={t('tree.moreActions')}>
              <MoreVertical />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => onAddItems(group)} disabled={group.is_locked}>
              <Plus className="h-4 w-4" />
              {t('menu.addItem')}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onOpenAll(group)} disabled={itemCount === 0}>
              <FolderOpen className="h-4 w-4" />
              {t('action.openAll')}
            </DropdownMenuItem>
            {onMoveGroup && (
              <DropdownMenuItem onSelect={() => onMoveGroup(group)} disabled={group.is_locked}>
                <FolderInput className="h-4 w-4" />
                {t('moveToFolder.title')}
              </DropdownMenuItem>
            )}
            {onColorTag && (
              <DropdownMenuItem onSelect={() => onColorTag(group)} disabled={group.is_locked}>
                <Palette className="h-4 w-4" />
                {t('menu.setColor')}
              </DropdownMenuItem>
            )}
            {onToggleLock && (
              <DropdownMenuItem onSelect={() => onToggleLock(group)}>
                {group.is_locked ? <LockOpen className="h-4 w-4" /> : <Lock className="h-4 w-4" />}
                {group.is_locked ? t('menu.unlock') : t('menu.lock')}
              </DropdownMenuItem>
            )}
            {onDedup && !group.is_folder && (
              <DropdownMenuItem onSelect={() => onDedup(group)} disabled={group.is_locked}>
                <CopyX className="h-4 w-4" />
                {t('menu.removeDuplicates')}
              </DropdownMenuItem>
            )}
            <DropdownMenuItem onSelect={() => onEdit(group)} disabled={group.is_locked}>
              <Pencil className="h-4 w-4" />
              {t('menu.rename')}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onDelete(group)} disabled={isDeleting || group.is_locked} className="text-destructive">
              <Trash2 className="h-4 w-4" />
              {t('action.delete')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  )
}
