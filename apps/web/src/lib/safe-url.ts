/** 仅允许 http/https 协议;非法或非 http(s) 返回 undefined(供 <a href> 兜底,渲染纯文本/不可点)。 */
export function safeHttpUrl(url: string | null | undefined): string | undefined {
  if (!url) return undefined
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return undefined
    return parsed.href
  } catch {
    return undefined
  }
}

/**
 * 图片 src 专用:在 safeHttpUrl 之上额外放行同源相对资产路径
 * (/api/...)——书签的 favicon/封面持久化到 R2 后,字段被改写为
 * `/api/v1/assets/...` 形式,由本站资产路由流式服务。
 * 仅认 /api/ 前缀的根相对路径,任意相对串不放行。
 */
export function safeImageSrc(url: string | null | undefined): string | undefined {
  if (url && url.startsWith('/api/')) return url
  return safeHttpUrl(url)
}
