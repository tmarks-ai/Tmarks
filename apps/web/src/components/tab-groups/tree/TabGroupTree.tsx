import { useState } from 'react'
import { cn } from '@/lib/utils'
import { Circle, Folder, FolderPlus } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { DndContext, DragOverlay } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import type { TabGroupDTO } from '@tmarks/contracts'
import { buildTree } from './treeUtils'
import { TabGroupTreeNode } from './TabGroupTreeNode'
import { useTreeDragAndDrop } from './useTreeDragAndDrop'
import { Button } from '@/components/ui/button'
import { Hint } from '@/components/ui/tooltip'

interface TabGroupTreeProps {
  groups: TabGroupDTO[]
  selectedFolderId: string | null
  onSelectFolder: (id: string | null) => void
  onCreateFolder: () => void
  onRenameFolder: (group: TabGroupDTO) => void
  onDeleteFolder: (group: TabGroupDTO) => void
  onMoveFolder: (group: TabGroupDTO) => void
  onColorTag?: (group: TabGroupDTO) => void
  onToggleLock?: (group: TabGroupDTO) => void
  onReorderGroup: (groupId: string, newParentId: string | null, newPosition: number) => void
  onCreateSubfolder: (parentId: string) => void
  i18nNs?: string
}

/** 标签页文件夹树:"全部"根 + buildTree 文件夹节点(可拖拽排序/移文件夹)+ 展开/折叠 + 创建入口。DndContext 包裹 SortableContext(verticalListSortingStrategy)+ DragOverlay。 */
export function TabGroupTree(props: TabGroupTreeProps) {
  const { t } = useTranslation(props.i18nNs || 'tabGroups')
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => {
    const folders = props.groups.filter((g) => g.is_folder).map((g) => g.id)
    return new Set(folders)
  })
  const toggleExpand = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }
  const treeData = buildTree(props.groups)
  const allNodeIds = props.groups.map((g) => g.id)
  const totalCount = props.groups.filter((group) => !group.is_folder).length
  const dnd = useTreeDragAndDrop({ tabGroups: props.groups, onMoveGroup: props.onReorderGroup })
  const activeGroup = dnd.activeId ? props.groups.find((g) => g.id === dnd.activeId) : null

  return (
    <div className="flex h-full min-h-0 w-full flex-col overflow-hidden rounded-2xl border border-border/70 bg-card shadow-sm">
      <div className="flex flex-shrink-0 items-center justify-between px-3.5 py-3">
        <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <Folder className="h-4 w-4 text-primary" />
          <span>{t('sidebar.title')}</span>
        </div>
        <Hint label={t('menu.createFolder')}>
          <Button variant="outline" size="icon" className="h-8 w-8" onClick={props.onCreateFolder} aria-label={t('menu.createFolder')}>
            <FolderPlus />
          </Button>
        </Hint>
      </div>
      <div className="mx-3 h-px flex-shrink-0 bg-border/70" />
      <div className="tmarks-scrollbar min-h-0 flex-1 overflow-y-auto px-2 py-2">
        <div
          role="button"
          tabIndex={0}
          aria-selected={props.selectedFolderId === null}
          className={cn(`flex cursor-pointer items-center gap-2 rounded-xl px-2.5 py-2 transition-colors hover:bg-muted/70 ${props.selectedFolderId === null ? 'bg-primary/10 text-primary' : 'text-foreground'}`)}
          onClick={() => props.onSelectFolder(null)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault()
              props.onSelectFolder(null)
            }
          }}
        >
          <Circle className={cn(`h-2.5 w-2.5 ${props.selectedFolderId === null ? 'fill-primary text-primary' : 'text-muted-foreground'}`)} />
          <span className="flex-1 text-sm font-medium">{t('sidebar.allGroups')}</span>
          <span className="text-xs text-muted-foreground">{totalCount}</span>
        </div>
        {treeData.length === 0 ? (
          <div className="px-3 py-8 text-center">
            <p className="text-xs text-muted-foreground/60">{t('sidebar.noGroups')}</p>
          </div>
        ) : (
          <DndContext
            sensors={dnd.sensors}
            collisionDetection={dnd.collisionDetection}
            onDragStart={dnd.handleDragStart}
            onDragMove={dnd.handleDragMove}
            onDragEnd={dnd.handleDragEnd}
            onDragCancel={dnd.handleDragCancel}
          >
            <SortableContext items={allNodeIds} strategy={verticalListSortingStrategy}>
              <div className="mt-1">
                {treeData.map((node) => (
                  <TabGroupTreeNode
                    key={node.id}
                    node={node}
                    level={1}
                    selectedFolderId={props.selectedFolderId}
                    onSelectFolder={props.onSelectFolder}
                    expandedIds={expandedIds}
                    onToggleExpand={toggleExpand}
                    onRename={props.onRenameFolder}
                    onDelete={props.onDeleteFolder}
                    onMoveGroup={props.onMoveFolder}
                    onColorTag={props.onColorTag}
                    onToggleLock={props.onToggleLock}
                    onCreateSubfolder={props.onCreateSubfolder}
                    overId={dnd.overId}
                    dropPosition={dnd.dropPosition}
                    i18nNs={props.i18nNs}
                  />
                ))}
              </div>
            </SortableContext>
            <DragOverlay>
              {activeGroup ? (
                <div className="flex items-center gap-1 rounded-xl bg-card px-2 py-1.5 shadow-lg">
                  <Folder className="h-4 w-4 text-primary" />
                  <span className="text-sm font-medium">{activeGroup.title}</span>
                </div>
              ) : null}
            </DragOverlay>
          </DndContext>
        )}
      </div>
    </div>
  )
}
