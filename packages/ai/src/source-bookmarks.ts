import type { SourceBookmark } from './types'
import { normalizeUrlKey } from './url'

export function findSourceBookmark(sourceBookmarks: SourceBookmark[] | undefined, url: string): SourceBookmark | undefined {
  const urlKey = normalizeUrlKey(url)
  return sourceBookmarks?.find((bookmark) => normalizeUrlKey(bookmark.url) === urlKey)
}
