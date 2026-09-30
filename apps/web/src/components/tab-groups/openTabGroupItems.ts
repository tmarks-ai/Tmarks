import type { TabGroupItemDTO } from '@tmarks/contracts'
import { isExtensionAvailable, openTabsViaExtension, type WindowMode } from '@/lib/extension-bridge'
import { safeHttpUrl } from '@/lib/safe-url'

/**
 * 打开一组标签页条目:优先经浏览器扩展桥接(支持 windowMode:新窗口/当前窗口/隐身),
 * 扩展不可用或失败时降级为逐个 window.open(新标签页)。
 * 返回 {opened, total};opened < total 表示部分被浏览器弹窗拦截。
 */
export async function openTabGroupItems(
  items: TabGroupItemDTO[],
  windowMode: WindowMode = 'new',
): Promise<{ opened: number; total: number }> {
  // 条目 URL 历史上无入口校验,javascript:/data: 可能已入库。展示路径都经
  // safeHttpUrl 渲染,这里是唯一的"执行"路径,必须同样过滤,否则存进去的
  // 危险协议会直达 window.open / 扩展 chrome.tabs.create。
  const urls = items
    .map((i) => safeHttpUrl(i.url))
    .filter((u): u is string => Boolean(u))
  if (urls.length === 0) return { opened: 0, total: 0 }

  if (isExtensionAvailable()) {
    const viaExt = await openTabsViaExtension(urls, windowMode)
    if (viaExt) return viaExt
  }

  let opened = 0
  for (const url of urls) {
    const popup = window.open(url, '_blank', 'noopener,noreferrer')
    if (popup) opened += 1
  }
  return { opened, total: urls.length }
}
