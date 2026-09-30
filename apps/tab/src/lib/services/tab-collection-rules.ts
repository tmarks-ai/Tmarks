/**
 * 标签页 URL 是否可采集:仅 http/https 网页。对齐旧 aitmarks 正向白名单,
 * 排除 chrome:/about:/devtools:/view-source:/file:/data:/blob: 等内部与非网页协议。
 */
export function isCollectableTabUrl(url?: string | null): url is string {
  if (!url) return false
  try {
    const protocol = new URL(url).protocol.toLowerCase()
    return protocol === 'http:' || protocol === 'https:'
  } catch {
    return false
  }
}
