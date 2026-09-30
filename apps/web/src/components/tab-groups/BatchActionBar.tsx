import { useTranslation } from 'react-i18next'
import { BatchActionBar as CommonBatchActionBar } from '@/components/common/BatchActionBar'

interface BatchActionBarProps {
  selectedCount: number
  totalCount: number
  isPending: boolean
  canPin: boolean
  canUnpin: boolean
  canTodo: boolean
  canUntodo: boolean
  canArchive: boolean
  canUnarchive: boolean
  onSelectAll: () => void
  onClearSelection: () => void
  onPin: () => void
  onUnpin: () => void
  onTodo: () => void
  onUntodo: () => void
  onArchive: () => void
  onUnarchive: () => void
  onExport: () => void
  onDelete: () => void
}

/** 标签组批量操作栏(common/BatchActionBar 的命名空间适配层)。 */
export function BatchActionBar(props: BatchActionBarProps) {
  const { t } = useTranslation('tabGroups')
  return (
    <CommonBatchActionBar
      {...props}
      t={t}
      deleteTitle={t('confirm.batchDelete')}
      deleteMessage={t('confirm.batchDeleteMessage', { count: props.selectedCount })}
    />
  )
}