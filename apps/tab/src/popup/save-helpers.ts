/** useBookmarkSave 的模块级纯助手(标签合并/缩略图过滤/最近目录/页面信息读取)。 */

export interface PageInfoResponse { title?: string; description?: string; content?: string; favicon?: string; thumbnail?: string; thumbnails?: string[] }

export const LAST_FOLDER_KEY = 'tmark:lastFolderId'

export function mergeDirty(existing: string[], changed: string[]): string[] { return [...new Set([...existing, ...changed])] }

/** 选中标签合并(大小写不敏感):已有拼写优先,避免"LLM"与"llm"并存成两个选中态。 */
export function mergeSelectedTags(cur: string[], incoming: string[]): string[] {
  const byKey = new Map(cur.map((name) => [name.toLowerCase(), name]))
  for (const name of incoming) {
    const key = name.toLowerCase()
    if (!byKey.has(key)) byKey.set(key, name)
  }
  return [...byKey.values()]
}

/** 缩略图只收 http(s):og:image 可能是 data:/blob: 等非 http 值,若混进
 * thumbnails,轮播(过滤后的下标)与 handleThumbnailChange(原始下标)两个
 * 索引空间错位——显示 A 保存 B。在源头过滤,两个空间永远一致。 */
export function isHttpImageUrl(value: string | undefined | null): value is string {
  if (!value) return false
  try {
    const parsed = new URL(value)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}

export const getLastFolderId = (): Promise<string | null> => new Promise((r) => chrome.storage.local.get(LAST_FOLDER_KEY, (o) => r((o[LAST_FOLDER_KEY] as string | undefined) ?? null)))
export const setLastFolderId = (id: string | null): Promise<void> => new Promise((r) => chrome.storage.local.set({ [LAST_FOLDER_KEY]: id }, () => r()))

export async function readPageInfo(tabId: number | undefined): Promise<PageInfoResponse | null> {
  if (tabId == null) return null
  // 经 background 取页面信息:content script 无注入时由 background executeScript 兜底。
  return chrome.runtime.sendMessage({ type: 'EXTRACT_PAGE_INFO_BG', tabId }).then((res) => res as PageInfoResponse | null).catch(() => null)
}
