import { useCallback, useEffect, useMemo, useState } from 'react'
import { useInfiniteBookmarks } from '@/hooks/useBookmarks'
import type { BookmarkQueryParams } from '@tmarks/contracts'

/**
 * 游标分页 + 本地页索引:用 useInfiniteQuery 预取下一页,翻页时优先复用已缓存页,
 * 仅在向后再无缓存且 hasNextPage 时触发 fetchNextPage。
 */
export function usePagedBookmarks(params: BookmarkQueryParams, pageSize: number) {
  const [pageIndex, setPageIndex] = useState(0)
  const queryParams = useMemo(() => ({ ...params, page_size: pageSize }), [params, pageSize])
  // Reset on the *value* of the filters, not the identity of the object: a
  // caller that rebuilds params inline would otherwise snap back to page 1 on
  // every render, making the list impossible to page through.
  const queryParamsKey = JSON.stringify(queryParams)
  const query = useInfiniteBookmarks(queryParams)
  const pages = query.data?.pages ?? []
  // A mutation can shrink the result set (batch-deleting a whole page), leaving
  // pageIndex past the end and showing an empty list with no way back but Prev.
  const safePageIndex = pages.length > 0 ? Math.min(pageIndex, pages.length - 1) : 0
  const currentPageData = pages[safePageIndex]
  const bookmarks = currentPageData?.bookmarks ?? []

  useEffect(() => {
    setPageIndex(0)
  }, [queryParamsKey])

  // Keep the stored index in step once a refetch has settled, so Next/Prev do
  // not have to walk back through pages that no longer exist.
  useEffect(() => {
    if (pages.length > 0 && pageIndex > pages.length - 1) setPageIndex(pages.length - 1)
  }, [pages.length, pageIndex])

  const goPrevious = useCallback(() => {
    setPageIndex((current) => Math.max(0, current - 1))
  }, [])

  const goNext = useCallback(async () => {
    if (safePageIndex < pages.length - 1) {
      setPageIndex(safePageIndex + 1)
      return
    }
    if (!query.hasNextPage || query.isFetchingNextPage) return
    const result = await query.fetchNextPage()
    if (!result.error) setPageIndex(safePageIndex + 1)
  }, [safePageIndex, pages.length, query])

  return {
    bookmarks,
    query,
    relatedTagIds: currentPageData?.meta?.related_tag_ids,
    pagination: {
      currentPage: safePageIndex + 1,
      pageSize,
      currentCount: bookmarks.length,
      hasPreviousPage: safePageIndex > 0,
      hasNextPage: safePageIndex < pages.length - 1 || Boolean(query.hasNextPage),
      isLoading: query.isFetchingNextPage,
      onPreviousPage: goPrevious,
      onNextPage: goNext,
    },
  }
}
