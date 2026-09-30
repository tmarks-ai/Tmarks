/**
 * Web ↔ 浏览器扩展桥接(Web 侧)。扩展在可信源上设置 document.documentElement.dataset.tmarksExtension='1'
 * 并监听 window.postMessage({ source:'TMARKS_WEB', type, requestId, ... })。
 *
 * 本模块向扩展中继 OPEN_TABS / GET_SYNC_STATUS 请求,按 requestId 匹配一次响应,3s 超时返回 null
 * (调用方据此降级,例如 openTabGroupItems 退回 window.open)。
 * 安全校验:仅接受同窗口、同源回传的 source='TMARKS_EXTENSION' 消息。
 */

export type WindowMode = 'new' | 'current' | 'incognito'

export interface ExtensionSyncStatus {
  syncMode: 'local_only' | 'cloud_sync' | 'paused'
  pendingOps: number
  lastSyncAt: string | null
  counts: {
    bookmarks: number
    folders: number
    tags: number
    tabGroups: number
    tabGroupItems: number
  }
}

const BRIDGE_TIMEOUT_MS = 3000

function genRequestId(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36)
}

/** 扩展是否在当前页面注入(可信源上 content script 设置 dataset)。 */
export function isExtensionAvailable(): boolean {
  return document.documentElement.dataset.tmarksExtension === '1'
}

interface BridgeResponse {
  type: string
  success: boolean
  data?: unknown
}

/**
 * 向扩展发送一次桥接请求,等待匹配 requestId 的响应;超时或异常返回 null。
 * expectedTypes:期望的回传消息 type 集合(含可能的 unavailable 信号)。
 */
function requestBridgeOnce(
  payload: Record<string, unknown>,
  expectedTypes: string[],
): Promise<BridgeResponse | null> {
  return new Promise((resolve) => {
    const requestId = genRequestId()
    let settled = false
    const handler = (event: MessageEvent) => {
      if (event.source !== window || event.origin !== location.origin) return
      const data = event.data as { source?: string; type?: string; requestId?: string; success?: boolean; data?: unknown } | null
      if (!data || data.source !== 'TMARKS_EXTENSION' || data.requestId !== requestId) return
      if (!expectedTypes.includes(data.type ?? '')) return
      if (settled) return
      settled = true
      window.removeEventListener('message', handler)
      resolve({ type: data.type ?? '', success: Boolean(data.success), data: data.data })
    }
    window.addEventListener('message', handler)
    window.postMessage({ ...payload, source: 'TMARKS_WEB', requestId }, location.origin)
    setTimeout(() => {
      if (settled) return
      settled = true
      window.removeEventListener('message', handler)
      resolve(null)
    }, BRIDGE_TIMEOUT_MS)
  })
}

/** 经扩展打开一组 URL;成功返回 {opened,total},扩展不可用/超时/失败返回 null(调用方降级)。 */
export async function openTabsViaExtension(
  urls: string[],
  windowMode: WindowMode = 'new',
): Promise<{ opened: number; total: number } | null> {
  if (!isExtensionAvailable() || urls.length === 0) return null
  const res = await requestBridgeOnce({ type: 'OPEN_TABS', urls, windowMode }, ['OPEN_TABS_RESULT'])
  if (res?.success && (res.data as { ok?: boolean } | undefined)?.ok) {
    return { opened: urls.length, total: urls.length }
  }
  return null
}

/** 查询扩展本地同步状态;不可用/超时返回 null。 */
export async function getExtensionSyncStatus(): Promise<ExtensionSyncStatus | null> {
  if (!isExtensionAvailable()) return null
  const res = await requestBridgeOnce(
    { type: 'GET_SYNC_STATUS' },
    ['SYNC_STATUS_RESPONSE', 'SYNC_STATUS_UNAVAILABLE'],
  )
  if (!res || res.type === 'SYNC_STATUS_UNAVAILABLE' || !res.success) return null
  const data = res.data as { ok?: boolean; data?: ExtensionSyncStatus } | undefined
  if (data?.ok && data.data) return data.data
  return null
}
