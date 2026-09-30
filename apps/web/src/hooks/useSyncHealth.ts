import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { syncHealthService } from '@/services/sync-health'

const QUERY_KEY = 'sync-health'

export function useSyncSummary() {
  return useQuery({
    queryKey: [QUERY_KEY],
    queryFn: () => syncHealthService.getSummary(),
    staleTime: 30 * 1000,
    // 继承全局 shouldRetry(仅网络/5xx):retry:1 会连 4xx 一起重试,
    // 白白烧配额并推迟本可直接展示的错误。
  })
}

/**
 * Web 端是云端客户端，本身没有本地变更可 push（/sync/push 需要 device_id + operations，
 * 空体调用必然失败）。这里的「触发同步」实际是重新拉取最新汇总并刷新展示。
 */
export function useTriggerSync() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async () => {
      await qc.refetchQueries({ queryKey: [QUERY_KEY], type: 'active' })
      // refetchQueries 对失败的查询也不 reject——不手动检查状态的话,刷新
      // 失败时调用方仍走 onSuccess 弹"已刷新",与页面上同时出现的错误态矛盾。
      if (qc.getQueryState([QUERY_KEY])?.status === 'error') {
        throw new Error('sync health refetch failed')
      }
    },
  })
}
