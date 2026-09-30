/** 页面内容/元信息提取器(标题/描述/正文/缩略图/favicon)。移植自旧 aitmarks,精简。 */

export interface PageInfo {
  title: string
  url: string
  description: string
  content: string
  thumbnail: string
  thumbnails: string[]
  favicon: string
}

/**
 * 自包含页面信息提取(无模块引用、无闭包)→ 可经 chrome.scripting.executeScript({func})
 * 注入页面上下文。content script 与 background 兜底注入共用此单一实现。
 */
export function extractPageInfoFn(): PageInfo {
  const safeUrl = (value: string, base: string = location.href): string => {
    try { return new URL(value, base).href } catch { return '' }
  }
  const meta = (name: string): string => {
    const el = document.querySelector(`meta[name="${name}"], meta[property="${name}"]`)
    return el?.getAttribute('content') || ''
  }
  const getTitle = (): string =>
    document.title || meta('og:title') || document.querySelector('h1')?.textContent?.trim() || 'Untitled'
  const getDescription = (): string =>
    meta('description') || meta('og:description') || meta('twitter:description') || ''
  const getMainContent = (): string => {
    const root = document.querySelector('article') || document.querySelector('main') || document.querySelector('[role="main"]') || document.body
    if (!root) return ''
    const clone = root.cloneNode(true) as HTMLElement
    clone.querySelectorAll('script, style, nav, header, footer, iframe, noscript').forEach((el) => el.remove())
    return (clone.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 1000)
  }
  const getFavicon = (): string => {
    const apple = Array.from(document.querySelectorAll<HTMLLinkElement>('link[rel="apple-touch-icon"]'))
    const best = apple.find((l) => l.href)
    if (best?.href) return safeUrl(best.href)
    const icons = Array.from(document.querySelectorAll<HTMLLinkElement>('link[rel*="icon"]'))
    const svg = icons.find((l) => (l.getAttribute('type') || l.href).includes('svg'))
    if (svg?.href) return safeUrl(svg.href)
    const largest = icons
      .map((l) => ({ l, size: parseInt((l.getAttribute('sizes') || '0x0').split('x')[0] || '0', 10) || 0 }))
      .sort((a, b) => b.size - a.size)[0]
    if (largest?.l.href) return safeUrl(largest.l.href)
    return safeUrl('/favicon.ico')
  }
  const getThumbnails = (): string[] => {
    const out: string[] = []
    const add = (v: string) => { if (v && !out.includes(v)) out.push(v) }
    add(meta('og:image') ? safeUrl(meta('og:image')) : '')
    add(meta('twitter:image') ? safeUrl(meta('twitter:image')) : '')
    const areas = [document.querySelector('main'), document.querySelector('[role="main"]'), document.querySelector('article'), document.body].filter(Boolean) as HTMLElement[]
    const found: Array<{ url: string; area: number }> = []
    for (const area of areas) {
      for (const img of Array.from(area.querySelectorAll('img'))) {
        const src = img.currentSrc || img.src
        if (!src || src.startsWith('data:') || src.startsWith('blob:')) continue
        const w = img.naturalWidth || parseInt(img.getAttribute('width') || '0', 10) || 0
        const h = img.naturalHeight || parseInt(img.getAttribute('height') || '0', 10) || 0
        if (w > 200 && h > 200 && w < 5000 && h < 5000) {
          const url = safeUrl(src)
          if (url && !found.some((f) => f.url === url)) found.push({ url, area: w * h })
        }
      }
    }
    found.sort((a, b) => b.area - a.area).slice(0, 5).forEach((f) => add(f.url))
    return out
  }
  const thumbnails = getThumbnails()
  return {
    title: getTitle(),
    url: location.href,
    description: getDescription(),
    content: getMainContent(),
    thumbnail: thumbnails[0] || '',
    thumbnails,
    favicon: getFavicon(),
  }
}

export class PageContentExtractor {
  extract(): PageInfo {
    return extractPageInfoFn()
  }
}
