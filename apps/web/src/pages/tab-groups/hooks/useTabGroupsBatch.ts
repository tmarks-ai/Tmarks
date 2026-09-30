import { useTranslation } from 'react-i18next'
import type { TabGroupDTO } from '@tmarks/contracts'
import { useBatchTabGroupItems } from '@/hooks/useTabGroups'
import { useToastStore } from '@/stores/toastStore'
import { downloadBlob, exportTabGroupsMarkdown } from '@/lib/export-tab-groups'

interface UseTabGroupsBatchOptions {
  allGroups: TabGroupDTO[]
  selectedIds: string[]
  onClearSelection: () => void
}

/** 后端 items/batch 单次上限(镜像 lib/tab-groups/tab-group-items.ts 的 MAX_BATCH_SIZE)。 */
const MAX_BATCH_SIZE = 100

/** 批量操作编排:选择的 canX 判断 + 批量固定/待办/归档/删除/导出 handlers。 */
export function useTabGroupsBatch({ allGroups, selectedIds, onClearSelection }: UseTabGroupsBatchOptions) {
  const { t } = useTranslation('tabGroups')
  const toast = useToastStore.getState()
  const batchItems = useBatchTabGroupItems()

  const selectedItems = allGroups.flatMap((g) => g.items || []).filter((item) => selectedIds.includes(item.id))
  const canPin = selectedItems.some((item) => !item.is_pinned)
  const canUnpin = selectedItems.some((item) => item.is_pinned)
  const canTodo = selectedItems.some((item) => !item.is_todo)
  const canUntodo = selectedItems.some((item) => item.is_todo)
  const canArchive = selectedItems.some((item) => !item.is_archived)
  const canUnarchive = selectedItems.some((item) => item.is_archived)

  // 全选在大页(page_size 可到 200)下可达数百条,超出后端单次 100 上限整包必
  // 400——按 100 分块顺序执行。失败 toast 只由 hook 级 onError 出
  // (describeMutationError),此处不再叠加,避免一次失败弹双 toast。
  const runBatch = async (input: Parameters<typeof batchItems.mutate>[0], successKey: string) => {
    if (input.item_ids.length === 0) return
    const chunks: string[][] = []
    for (let i = 0; i < input.item_ids.length; i += MAX_BATCH_SIZE) {
      chunks.push(input.item_ids.slice(i, i + MAX_BATCH_SIZE))
    }
    try {
      for (const item_ids of chunks) {
        await batchItems.mutateAsync({ ...input, item_ids })
      }
      toast.success(t(successKey))
      onClearSelection()
    } catch {
      // hook 级 onError 已 toast;吞掉 rejection 防止未处理告警。
    }
  }
  const onPin = () => void runBatch({ action: 'update', item_ids: selectedIds, data: { is_pinned: true } }, 'message.batchPinSuccess')
  const onUnpin = () => void runBatch({ action: 'update', item_ids: selectedIds, data: { is_pinned: false } }, 'message.batchUnpinSuccess')
  const onTodo = () => void runBatch({ action: 'update', item_ids: selectedIds, data: { is_todo: true } }, 'message.batchTodoSuccess')
  const onUntodo = () => void runBatch({ action: 'update', item_ids: selectedIds, data: { is_todo: false } }, 'message.batchUntodoSuccess')
  const onArchive = () => void runBatch({ action: 'update', item_ids: selectedIds, data: { is_archived: true } }, 'message.batchArchiveSuccess')
  const onUnarchive = () => void runBatch({ action: 'update', item_ids: selectedIds, data: { is_archived: false } }, 'message.batchUnarchiveSuccess')
  const onDelete = () => void runBatch({ action: 'delete', item_ids: selectedIds }, 'message.batchDeleteSuccess')
  const onExport = () => {
    downloadBlob(exportTabGroupsMarkdown(allGroups, selectedIds, t('batch.export')), `tab-groups-${Date.now()}.md`)
    toast.success(t('message.exportSuccess'))
    onClearSelection()
  }

  return {
    isPending: batchItems.isPending,
    canPin,
    canUnpin,
    canTodo,
    canUntodo,
    canArchive,
    canUnarchive,
    onPin,
    onUnpin,
    onTodo,
    onUntodo,
    onArchive,
    onUnarchive,
    onExport,
    onDelete,
  }
}
