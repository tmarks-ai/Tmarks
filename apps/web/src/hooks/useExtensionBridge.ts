import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getExtensionSyncStatus, isExtensionAvailable, type ExtensionSyncStatus } from '@/lib/extension-bridge'

/**
 * 扩展可用性:content script 可能在 SPA 挂载后才注入并设置 dataset,故挂载后短轮询若干次再 settle。
 * 返回 null(探测中)/ true / false;1s 内最多复查 5 次。
 */
export function useExtensionAvailable(): boolean | null {
  const [available, setAvailable] = useState<boolean | null>(null)
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null
    let checks = 0
    const check = () => {
      checks += 1
      if (isExtensionAvailable()) {
        setAvailable(true)
        return
      }
      if (checks >= 5) {
        setAvailable(false)
        return
      }
      timer = setTimeout(check, 200)
    }
    check()
    return () => { if (timer !== null) clearTimeout(timer) }
  }, [])
  return available
}

/** 扩展本地同步状态;仅当扩展可用时查询(短 staleTime,与 sync-health 卡片一致)。 */
export function useExtensionSyncStatus(enabled: boolean) {
  return useQuery<ExtensionSyncStatus | null>({
    queryKey: ['extension-sync-status'],
    queryFn: async () => getExtensionSyncStatus(),
    enabled,
    staleTime: 30 * 1000,
    // 刻意不继承全局 shouldRetry:这不是网络请求而是 postMessage 探针,失败
    // 即扩展不在(重试不会好转),快进到"不可用"占位;焦点回归会再探测。
    retry: 0,
    refetchOnWindowFocus: 'always',
  })
}
