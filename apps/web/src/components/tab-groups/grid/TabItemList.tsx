import { useTranslation } from 'react-i18next'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import type { TabGroupItemDTO } from '@tmarks/contracts'
import { TabItemRow } from './TabItemRow'
import type { ItemDropPosition } from './useItemDragAndDrop'

interface TabItemListProps {
  items: TabGroupItemDTO[]
  groupId: string
  groupLocked?: boolean
  onEditItem: (item: TabGroupItemDTO) => void
  onDeleteItem: (item: TabGroupItemDTO) => void
  onTogglePin?: (item: TabGroupItemDTO) => void
  onToggleTodo?: (item: TabGroupItemDTO) => void
  onToggleArchive?: (item: TabGroupItemDTO) => void
  onMoveItem?: (item: TabGroupItemDTO) => void
  batchMode?: boolean
  selectedIds?: string[]
  onToggleSelect?: (id: string) => void
  overId?: string | null
  dropPosition?: ItemDropPosition | null
  i18nNs?: string
}

/** 标签页条目列表:按 position 升序渲染,SortableContext(verticalListSortingStrategy)包裹 TabItemRow 支持组内拖拽排序,空列表提示;批量模式下透传选择状态。 */
export function TabItemList({
  items,
  groupId,
  groupLocked,
  onEditItem,
  onDeleteItem,
  onTogglePin,
  onToggleTodo,
  onToggleArchive,
  onMoveItem,
  batchMode,
  selectedIds,
  onToggleSelect,
  overId,
  dropPosition,
  i18nNs = 'tabGroups',
}: TabItemListProps) {
  const { t } = useTranslation(i18nNs)
  if (items.length === 0) {
    return <p className="px-2 py-3 text-center text-xs text-muted-foreground">{t('message.noTabsInGroup')}</p>
  }
  const sorted = [...items].sort((a, b) => a.position - b.position)
  return (
    <SortableContext items={sorted.map((item) => item.id)} strategy={verticalListSortingStrategy}>
      <div className="space-y-0.5">
        {sorted.map((item) => (
          <TabItemRow
            key={item.id}
            item={item}
            groupId={groupId}
            groupLocked={groupLocked}
            onEdit={onEditItem}
            onDelete={onDeleteItem}
            onTogglePin={onTogglePin}
            onToggleTodo={onToggleTodo}
            onToggleArchive={onToggleArchive}
            onMoveItem={onMoveItem}
            batchMode={batchMode}
            selected={selectedIds?.includes(item.id)}
            onToggleSelect={onToggleSelect}
            overId={overId}
            dropPosition={dropPosition}
            i18nNs={i18nNs}
          />
        ))}
      </div>
    </SortableContext>
  )
}
