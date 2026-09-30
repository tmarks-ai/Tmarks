import { extractPageInfoFn, type PageInfo } from '../content/page-content-extractor'
import { capturePageSnapshot, type PageSnapshot } from '../content/page-snapshot'

/**
 * 页面信息提取兜底:优先走已注入的 content script(chrome.tabs.sendMessage),
 * 无接收方(扩展安装前已开的页面未注入)时回退 chrome.scripting.executeScript 注入
 * 自包含提取函数。单一 try/fallback 例程,供 popup 的 pageInfo / 快照采集两条路径复用。
 */
export async function extractPageInfoBg(tabId: number): Promise<PageInfo | null> {
  const viaContent = await chrome.tabs.sendMessage(tabId, { type: 'EXTRACT_PAGE_INFO' }).catch(() => null)
  if (viaContent) return viaContent as PageInfo
  try {
    const [res] = await chrome.scripting.executeScript({ target: { tabId }, func: extractPageInfoFn })
    return (res?.result as PageInfo) ?? null
  } catch (e) {
    console.warn('[TMark] executeScript page-info fallback failed:', e)
    return null
  }
}

export async function capturePageBg(tabId: number): Promise<PageSnapshot | null> {
  const viaContent = await chrome.tabs.sendMessage(tabId, { type: 'CAPTURE_PAGE' }).catch(() => null)
  if (viaContent) return viaContent as PageSnapshot
  try {
    const [res] = await chrome.scripting.executeScript({ target: { tabId }, func: capturePageSnapshot })
    return (res?.result as PageSnapshot) ?? null
  } catch (e) {
    console.warn('[TMark] executeScript snapshot fallback failed:', e)
    return null
  }
}
