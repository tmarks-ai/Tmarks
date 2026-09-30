/**
 * Web Bridge(自包含注入函数,经 chrome.scripting.executeScript({func}) 按需注入)。
 *
 * 网页侧(Web SPA)通过 `window.postMessage({ source:'TMARKS_WEB', type:'OPEN_TABS' | 'GET_SYNC_STATUS', ... })`
 * 请求扩展能力;本函数挂载监听,中继到 background,并回传
 * `{ source:'TMARKS_EXTENSION', type:'OPEN_TABS_RESULT' | 'SYNC_STATUS_RESPONSE' | 'SYNC_STATUS_UNAVAILABLE', requestId, ... }`。
 *
 * 约束(见 background/bridge-inject.ts):
 * - 函数体内不得引用任何模块导入/闭包变量——executeScript 会把它序列化后
 *   在页面隔离世界执行,外部引用全部丢失(与 page-content-extractor 同规则)。
 * - 可信源判定不在页面侧做:注入时机(仅 API 源标签页)与消息中继
 *   (isTrustedBridgeOrigin)双重门禁都在 background,页面侧只负责安装。
 * - 幂等护栏:onUpdated('complete') 可能重复触发、SW 冷启动还会补注入,
 *   dataset 旗标既防止双监听器双中继,也是 SPA 的"扩展可用"信号。
 */
export function webBridgeInstaller(): void {
  const root = document.documentElement
  if (root.dataset.tmarksExtension === '1') return

  const post = (payload: Record<string, unknown>): void => {
    window.postMessage({ ...payload, source: 'TMARKS_EXTENSION' }, location.origin)
  }

  window.addEventListener('message', (event: MessageEvent) => {
    // 仅接受本窗口、同源页面发出的消息,排除嵌入的跨源 iframe 冒充 TMARKS_WEB 触发 OPEN_TABS。
    if (event.source !== window || event.origin !== location.origin) return
    const data = event.data as
      | { source?: string; type?: string; requestId?: string; urls?: unknown; windowMode?: 'new' | 'current' | 'incognito' }
      | null
    if (!data || typeof data !== 'object' || data.source !== 'TMARKS_WEB') return

    if (data.type === 'OPEN_TABS') {
      if (!Array.isArray(data.urls)) return
      const requestId = data.requestId ?? ''
      void chrome.runtime
        .sendMessage({ type: 'OPEN_TABS', urls: data.urls, windowMode: data.windowMode ?? 'new' })
        .then((result: unknown) => post({ type: 'OPEN_TABS_RESULT', requestId, success: true, data: result }))
        .catch((e: unknown) =>
          post({ type: 'OPEN_TABS_RESULT', requestId, success: false, data: null, error: e instanceof Error ? e.message : 'open tabs failed' })
        )
      return
    }

    if (data.type === 'GET_SYNC_STATUS') {
      const requestId = data.requestId ?? ''
      // success:true 是 web 侧getExtensionSyncStatus 的硬校验:此前的桥实现
      // 漏带该字段,SPA 永远把可用状态当"不可用"渲染(协议双端核对发现)。
      void chrome.runtime
        .sendMessage({ type: 'GET_SYNC_STATUS' })
        .then((result: unknown) => post({ type: 'SYNC_STATUS_RESPONSE', requestId, success: true, data: result }))
        .catch(() => post({ type: 'SYNC_STATUS_UNAVAILABLE', requestId, success: false, data: null }))
      return
    }
  })

  root.dataset.tmarksExtension = '1'
}
