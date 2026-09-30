/**
 * Web bridge 按需注入:静态 content_scripts 曾随每个 http(s) 页面加载
 * (全量 document_idle 注入),实际只有 API 源页面需要桥。改为:
 * - tabs.onUpdated('complete') 时,来源是 API 源的标签页才注入桥函数;
 * - SW 冷启动时对已打开的 API 源标签页补注入(等价原"安装前已开页面"兜底)。
 * 消息中继侧的门禁(isTrustedBridgeOrigin,见 background/index.ts)不变,
 * 即使误注入,非信任源的 OPEN_TABS/GET_SYNC_STATUS 中继也会被拒。
 */
import { webBridgeInstaller } from '../content/web-bridge'
import { getApiOrigin } from '../lib/api/config'

// Dev 构建里 SPA(vite)与 worker 分占不同 localhost 端口,回环信任必须忽略
// 端口;同规则放到生产会信任用户机器上任意 localhost 页面,故仅 DEV 生效。
const TRUSTED_LOCAL_HOSTS = new Set(['localhost', '127.0.0.1'])

function isBridgeTabUrl(apiOrigin: string, tabUrl: string): boolean {
  try {
    const api = new URL(apiOrigin)
    const cur = new URL(tabUrl)
    if (
      import.meta.env.DEV &&
      TRUSTED_LOCAL_HOSTS.has(api.hostname) &&
      TRUSTED_LOCAL_HOSTS.has(cur.hostname)
    ) {
      return true
    }
    return api.origin === cur.origin
  } catch {
    return false
  }
}

/** 把桥函数注入一个标签页(仅 API 源;注入函数自带幂等护栏)。 */
export async function injectWebBridgeIntoTab(tabId: number, tabUrl: string | undefined): Promise<void> {
  if (!tabUrl || !/^https?:/i.test(tabUrl)) return
  const apiOrigin = await getApiOrigin()
  if (!apiOrigin || !isBridgeTabUrl(apiOrigin, tabUrl)) return
  try {
    await chrome.scripting.executeScript({ target: { tabId }, func: webBridgeInstaller })
  } catch (e) {
    // 标签页可能在判定与注入之间关闭/导航,或页面拒绝注入(如 chrome://)。
    console.warn('[TMark] web bridge injection skipped:', e)
  }
}

/** SW 冷启动补注入:扩展安装/更新或 SW 复活前就已打开的 API 源标签页。 */
export async function injectWebBridgeIntoExistingTabs(): Promise<void> {
  try {
    const tabs = await chrome.tabs.query({})
    await Promise.all(
      tabs
        .filter((tab) => typeof tab.id === 'number')
        .map((tab) => injectWebBridgeIntoTab(tab.id as number, tab.url))
    )
  } catch (e) {
    console.warn('[TMark] existing-tab bridge injection failed:', e)
  }
}
