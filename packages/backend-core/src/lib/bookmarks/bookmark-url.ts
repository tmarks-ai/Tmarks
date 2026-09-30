export function normalizeBookmarkUrl(url: string): string {
  const trimmed = url.trim()
  try {
    const parsed = new URL(trimmed)
    parsed.hash = ''
    parsed.protocol = parsed.protocol.toLowerCase()
    parsed.hostname = parsed.hostname.toLowerCase()
    return trimTrailingSlash(parsed.toString())
  } catch {
    return trimTrailingSlash(trimmed)
  }
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/$/, '')
}
