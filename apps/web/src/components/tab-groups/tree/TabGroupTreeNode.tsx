import { ChevronDown, ChevronRight, Folder, FolderInput, FolderPlus, GripVertical, Layers, Lock, LockOpen, MoreVertical, Palette, Pencil, Trash2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useTranslation } from 'react-i18next'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { TabGroupTreeNode as TreeNodeType } from './treeUtils'
import { getTotalItemCount } from './treeUtils'
import type { DropPosition } from './useTreeDragAndDrop'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

interface TabGroupTreeNodeProps {
  node: TreeNodeType
  level: number
  selectedFolderId: string | null
  onSelectFolder: (id: string | null) => void
  expandedIds: Set<string>
  onToggleExpand: (id: string) => void
  onRename: (group: TreeNodeType) => void
  onDelete: (group: TreeNodeType) => void
  onMoveGroup: (group: TreeNodeType) => void
  onCreateSubfolder: (parentId: string) => void
  onColorTag?: (group: TreeNodeType) => void
  onToggleLock?: (group: TreeNodeType) => void
  overId?: string | null
  dropPosition?: DropPosition | null
  i18nNs?: string
}

/** 树节点:useSortable 拖拽 + drag handle + before/inside/after 指示器 + 文件夹图标(着组色)/标题/计数 + DropdownMenu(建子夹/重命名/颜色标签/锁定/移动/删除)。锁定节点禁用拖拽与结构类操作。 */
export function TabGroupTreeNode(props: TabGroupTreeNodeProps) {
  const { t } = useTranslation(props.i18nNs || 'tabGroups')
  const { node, level, overId, dropPosition } = props
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: node.id, data: { type: 'group' }, disabled: !!node.is_locked })
  const visibleChildren = node.is_folder ? node.children : []
  const hasChildren = visibleChildren.length > 0
  const isExpanded = props.expandedIds.has(node.id)
  const isSelected = props.selectedFolderId === node.id
  const itemCount = getTotalItemCount(node)
  const isOver = overId === node.id
  const indicator = isOver && dropPosition === 'before' ? 'before'
    : isOver && dropPosition === 'after' ? 'after'
    : isOver && dropPosition === 'inside' ? 'inside'
    : ''
  const indicatorClass = indicator === 'before' ? 'border-t-2 border-primary'
    : indicator === 'after' ? 'border-b-2 border-primary'
    : indicator === 'inside' ? 'ring-2 ring-primary bg-primary/5'
    : ''

  return (
    <div ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }} className={isDragging ? 'opacity-50' : ''}>
      <div
        role="button"
        tabIndex={0}
        aria-selected={isSelected}
        className={cn(`group flex cursor-pointer items-center gap-1 rounded-xl border-transparent py-1.5 pr-1.5 transition-colors hover:bg-muted/70 ${isSelected ? 'bg-primary/10 text-primary' : 'text-foreground'} ${indicatorClass}`)}
        style={{ paddingLeft: `${level * 8 + 4}px` }}
        onClick={() => props.onSelectFolder(node.id)}
        onKeyDown={(event) => {
          if (event.target !== event.currentTarget) return
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            props.onSelectFolder(node.id)
          }
        }}
      >
        <button
          type="button"
          className="flex h-5 w-5 items-center justify-center text-muted-foreground"
          onClick={(e) => { e.stopPropagation(); props.onToggleExpand(node.id) }}
          aria-label={isExpanded ? t('tree.collapse') : t('tree.expand')}
        >
          {hasChildren ? (isExpanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />) : null}
        </button>
        {node.is_folder ? (
          <Folder className="h-4 w-4 flex-shrink-0 text-primary" style={node.color ? { color: node.color } : undefined} />
        ) : (
          <Layers className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
        )}
        <span className="flex-1 truncate text-sm font-medium">{node.title}</span>
        {node.is_locked && <Lock className="h-3 w-3 flex-shrink-0 text-muted-foreground" aria-label={t('item.locked')} />}
        <span className="text-xs text-muted-foreground">{itemCount}</span>
        {node.is_locked ? (
          <span className="flex h-7 w-7 items-center justify-center text-muted-foreground" aria-hidden>
            <Lock className="h-3.5 w-3.5" />
          </span>
        ) : (
          <button
            type="button"
            className="flex h-7 w-7 cursor-grab items-center justify-center rounded-lg text-muted-foreground opacity-100 hover:bg-muted active:cursor-grabbing sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100"
            {...attributes}
            {...listeners}
            onClick={(e) => e.stopPropagation()}
            aria-label={t('menu.move')}
          >
            <GripVertical className="h-3.5 w-3.5" />
          </button>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground opacity-100 hover:bg-muted sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100"
              onClick={(e) => e.stopPropagation()}
              aria-label={t('tree.moreActions')}
            >
              <MoreVertical className="h-3.5 w-3.5" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {node.is_folder && (
              <DropdownMenuItem onClick={() => props.onCreateSubfolder(node.id)}>
                <FolderPlus className="h-4 w-4" />
                {t('menu.createFolderInside')}
              </DropdownMenuItem>
            )}
            <DropdownMenuItem onClick={() => props.onRename(node)} disabled={!!node.is_locked}>
              <Pencil className="h-4 w-4" />
              {t('menu.rename')}
            </DropdownMenuItem>
            {props.onColorTag && (
              <DropdownMenuItem onClick={() => props.onColorTag?.(node)} disabled={!!node.is_locked}>
                <Palette className="h-4 w-4" />
                {t('menu.setColor')}
              </DropdownMenuItem>
            )}
            {props.onToggleLock && (
              <DropdownMenuItem onClick={() => props.onToggleLock?.(node)}>
                {node.is_locked ? <LockOpen className="h-4 w-4" /> : <Lock className="h-4 w-4" />}
                {node.is_locked ? t('menu.unlock') : t('menu.lock')}
              </DropdownMenuItem>
            )}
            <DropdownMenuItem onClick={() => props.onMoveGroup(node)} disabled={!!node.is_locked}>
              <FolderInput className="h-4 w-4" />
              {t('moveToFolder.title')}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => props.onDelete(node)} disabled={!!node.is_locked} className="text-destructive">
              <Trash2 className="h-4 w-4" />
              {t('menu.moveToTrash')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {isExpanded && hasChildren && (
        <div>
          {visibleChildren.map((child) => (
            <TabGroupTreeNode
              key={child.id}
              node={child}
              level={level + 1}
              selectedFolderId={props.selectedFolderId}
              onSelectFolder={props.onSelectFolder}
              expandedIds={props.expandedIds}
              onToggleExpand={props.onToggleExpand}
              onRename={props.onRename}
              onDelete={props.onDelete}
              onMoveGroup={props.onMoveGroup}
              onCreateSubfolder={props.onCreateSubfolder}
              onColorTag={props.onColorTag}
              onToggleLock={props.onToggleLock}
              overId={overId}
              dropPosition={dropPosition}
              i18nNs={props.i18nNs}
            />
          ))}
        </div>
      )}
    </div>
  )
}
