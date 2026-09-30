import { useMutation, useQuery, useQueryClient, type QueryClient, type QueryKey } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import type {
  BatchTabGroupItemsInput,
  BatchUpdatePositionItem,
  CreateTabGroupInput,
  CreateTabGroupItemInput,
  DedupTabGroupInput,
  MoveTabGroupItemInput,
  TabGroupDTO,
  TabGroupItemDTO,
  UpdateTabGroupInput,
  UpdateTabGroupItemInput,
} from '@tmarks/contracts'
import { tabGroupsService } from '@/services/tab-groups'
import { useToastStore } from '@/stores/toastStore'
import { describeMutationError } from '@/lib/describe-error'

const TAB_GROUPS_QUERY_KEY = 'tab-groups'

/** 失效标签页组相关缓存(['tab-groups'] 前缀覆盖 trash/detail 子 key)。 */
function invalidateTabGroups(queryClient: QueryClient): Promise<void> {
  return queryClient.invalidateQueries({ queryKey: [TAB_GROUPS_QUERY_KEY] }).then(() => undefined)
}

/** mutation 失败统一提示(按错误类型分级文案)。 */
function useMutationError() {
  const { t } = useTranslation('common')
  const toast = useToastStore.getState()
  return (error?: unknown) => toast.error(describeMutationError(error, t))
}

/** 乐观更新辅助:applyItemMove/reindexItems 在 onMutate 改写缓存,rollbackTabGroups 在 onError 恢复快照。 */
type TabGroupsOptCtx = { previousList?: TabGroupDTO[]; previousDetails?: Array<[QueryKey, TabGroupDTO]> }
/** 条目数组按下标重写 position(乐观假设 0..n-1 连续,refetch 由后端纠正)。 */
function reindexItems(items: TabGroupItemDTO[]): TabGroupItemDTO[] {
  return items.map((it, idx) => ({ ...it, position: idx }))
}

/** 服务端序 = 置顶段(position ASC) ++ 非置顶段(position ASC),而 position
 * 是组内全局序:乐观插入的下标要按 pin 段换算(此前直接把 position 当数组
 * 下标,置顶条目存在时显示 A 闪到 B;refetch 会纠正,但换算消除闪跳)。 */
function optimisticInsertIndex(items: TabGroupItemDTO[], moved: TabGroupItemDTO, position: number | undefined): number {
  if (position == null) return items.length
  const pinnedPrefix = moved.is_pinned ? 0 : items.filter((i) => i.is_pinned).length
  const sameClass = items.filter((i) => Boolean(i.is_pinned) === Boolean(moved.is_pinned))
  const within = sameClass.filter((i) => i.position < position).length
  return Math.min(pinnedPrefix + within, items.length)
}

/** 对单个 group 应用条目移动:目标组插入并重排;源组(若不同)移除并重排;其余原样。 */
function applyItemMove(g: TabGroupDTO, moved: TabGroupItemDTO, targetId: string, position: number | undefined): TabGroupDTO {
  if (g.id === targetId) {
    const items = (g.items || []).filter((i) => i.id !== moved.id); items.splice(optimisticInsertIndex(items, moved, position), 0, { ...moved, group_id: targetId })
    return { ...g, items: reindexItems(items) }
  }
  return g.id === moved.group_id ? { ...g, items: reindexItems((g.items || []).filter((i) => i.id !== moved.id)) } : g
}

function rollbackTabGroups(queryClient: QueryClient, ctx: TabGroupsOptCtx | undefined): void {
  if (!ctx) return
  if (ctx.previousList !== undefined) queryClient.setQueryData([TAB_GROUPS_QUERY_KEY], ctx.previousList)
  for (const [key, data] of ctx.previousDetails ?? []) queryClient.setQueryData(key, data)
}

/** 全量标签页组(树需要全量,listAllTabGroups 自动分页聚合)。 */
export function useTabGroups() {
  return useQuery({
    queryKey: [TAB_GROUPS_QUERY_KEY],
    queryFn: () => tabGroupsService.listAllTabGroups(),
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: true,
  })
}

export function useTabGroupsTrashQuery() {
  return useQuery({
    queryKey: [TAB_GROUPS_QUERY_KEY, 'trash'],
    queryFn: () => tabGroupsService.getTrash(),
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: true,
  })
}

export function useTabGroupDetailQuery(id: string | null) {
  return useQuery({
    queryKey: [TAB_GROUPS_QUERY_KEY, 'detail', id],
    queryFn: () => tabGroupsService.getTabGroup(id!),
    enabled: Boolean(id),
    staleTime: 5 * 60 * 1000,
  })
}

export function useCreateTabGroup() {
  const queryClient = useQueryClient()
  const onError = useMutationError()
  return useMutation({
    mutationFn: (data: CreateTabGroupInput) => tabGroupsService.createTabGroup(data),
    onSuccess: () => invalidateTabGroups(queryClient),
    onError,
  })
}

export function useUpdateTabGroup() {
  const queryClient = useQueryClient()
  const onError = useMutationError()
  return useMutation({
    mutationFn: (input: { id: string; data: UpdateTabGroupInput }) =>
      tabGroupsService.updateTabGroup(input.id, input.data),
    onSuccess: () => invalidateTabGroups(queryClient),
    onMutate: async (input) => {
      const { parent_id, position } = input.data
      if (parent_id === undefined && position === undefined) return undefined
      await queryClient.cancelQueries({ queryKey: [TAB_GROUPS_QUERY_KEY] })
      const previousList = queryClient.getQueryData<TabGroupDTO[]>([TAB_GROUPS_QUERY_KEY]); if (!previousList) return { previousList }
      const next = previousList.map((g) => g.id === input.id
        ? { ...g, parent_id: parent_id === undefined ? g.parent_id : parent_id, position: position === undefined ? g.position : position } : g)
      queryClient.setQueryData([TAB_GROUPS_QUERY_KEY], next)
      return { previousList }
    },
    onError: (_err, _vars, ctx) => { rollbackTabGroups(queryClient, ctx); onError() },
  })
}

export function useDeleteTabGroup() {
  const queryClient = useQueryClient()
  const onError = useMutationError()
  return useMutation({
    mutationFn: (id: string) => tabGroupsService.deleteTabGroup(id),
    onSuccess: () => invalidateTabGroups(queryClient),
    onError,
  })
}

export function usePermanentDeleteTabGroup() {
  const queryClient = useQueryClient()
  const onError = useMutationError()
  return useMutation({
    mutationFn: (id: string) => tabGroupsService.permanentDeleteTabGroup(id),
    onSuccess: () => invalidateTabGroups(queryClient),
    onError,
  })
}

export function useRestoreTabGroup() {
  const queryClient = useQueryClient()
  const onError = useMutationError()
  return useMutation({
    mutationFn: (id: string) => tabGroupsService.restoreTabGroup(id),
    onSuccess: () => invalidateTabGroups(queryClient),
    onError,
  })
}

export function useAddTabGroupItems() {
  const queryClient = useQueryClient()
  const onError = useMutationError()
  return useMutation({
    mutationFn: (input: { groupId: string; items: CreateTabGroupItemInput[] }) =>
      tabGroupsService.addTabGroupItems(input.groupId, input.items),
    onSuccess: () => invalidateTabGroups(queryClient),
    onError,
  })
}

export function useUpdateTabGroupItem() {
  const queryClient = useQueryClient()
  const onError = useMutationError()
  return useMutation({
    mutationFn: (input: { itemId: string; data: UpdateTabGroupItemInput }) =>
      tabGroupsService.updateTabGroupItem(input.itemId, input.data),
    onSuccess: () => invalidateTabGroups(queryClient),
    onError,
  })
}

export function useDeleteTabGroupItem() {
  const queryClient = useQueryClient()
  const onError = useMutationError()
  return useMutation({
    mutationFn: (itemId: string) => tabGroupsService.deleteTabGroupItem(itemId),
    onSuccess: () => invalidateTabGroups(queryClient),
    onError,
  })
}

export function useMoveTabGroupItem() {
  const queryClient = useQueryClient()
  const onError = useMutationError()
  return useMutation({
    mutationFn: (input: { itemId: string; data: MoveTabGroupItemInput }) =>
      tabGroupsService.moveTabGroupItem(input.itemId, input.data),
    onSuccess: () => invalidateTabGroups(queryClient),
    onMutate: async (input) => {
      await queryClient.cancelQueries({ queryKey: [TAB_GROUPS_QUERY_KEY] })
      const previousList = queryClient.getQueryData<TabGroupDTO[]>([TAB_GROUPS_QUERY_KEY])
      const targetId = input.data.target_group_id; const moved = previousList?.flatMap((g) => g.items || []).find((i) => i.id === input.itemId)
      const previousDetails: Array<[QueryKey, TabGroupDTO]> = []
      if (previousList && moved) {
        queryClient.setQueryData([TAB_GROUPS_QUERY_KEY], previousList.map((g) => applyItemMove(g, moved, targetId, input.data.position)))
        for (const gid of new Set([targetId, moved.group_id])) {
          const key: QueryKey = [TAB_GROUPS_QUERY_KEY, 'detail', gid]; const d = queryClient.getQueryData<TabGroupDTO>(key)
          if (d) { previousDetails.push([key, d]); queryClient.setQueryData(key, applyItemMove(d, moved, targetId, input.data.position)) }
        }
      }
      return { previousList, previousDetails }
    },
    onError: (_err, _vars, ctx) => { rollbackTabGroups(queryClient, ctx); onError() },
  })
}

export function useBatchTabGroupItems() {
  const queryClient = useQueryClient()
  const onError = useMutationError()
  return useMutation({
    mutationFn: (input: BatchTabGroupItemsInput) => tabGroupsService.batchTabGroupItems(input),
    onSuccess: () => invalidateTabGroups(queryClient),
    onError,
  })
}

export function useBatchUpdatePositions() {
  const queryClient = useQueryClient()
  const onError = useMutationError()
  return useMutation({
    mutationFn: (updates: BatchUpdatePositionItem[]) => tabGroupsService.batchUpdatePositions(updates),
    onSuccess: () => invalidateTabGroups(queryClient),
    onMutate: async (updates) => {
      await queryClient.cancelQueries({ queryKey: [TAB_GROUPS_QUERY_KEY] })
      const previousList = queryClient.getQueryData<TabGroupDTO[]>([TAB_GROUPS_QUERY_KEY]); if (!previousList) return { previousList }
      const next = previousList.map((g) => {
        const u = updates.find((x) => x.id === g.id)
        return u ? { ...g, position: u.position, parent_id: u.parent_id !== undefined ? u.parent_id : g.parent_id } : g
      })
      queryClient.setQueryData([TAB_GROUPS_QUERY_KEY], next)
      return { previousList }
    },
    onError: (_err, _vars, ctx) => { rollbackTabGroups(queryClient, ctx); onError() },
  })
}

/** 组内 URL 去重(dry_run=true 仅预览);执行删除后失效 tab-groups 缓存。 */
export function useDedupTabGroup() {
  const queryClient = useQueryClient()
  const onError = useMutationError()
  return useMutation({
    mutationFn: (input: { groupId: string; data: DedupTabGroupInput }) =>
      tabGroupsService.dedupTabGroup(input.groupId, input.data),
    onSuccess: () => invalidateTabGroups(queryClient),
    onError,
  })
}
