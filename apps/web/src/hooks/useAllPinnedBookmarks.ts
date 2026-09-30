import { useQuery } from '@tanstack/react-query'
import { bookmarksService } from '@/services/bookmarks'
import type { BookmarkDTO, BookmarkQueryParams } from '@tmarks/contracts'

/**
 * R5-12: the pinned dock used the plain useBookmarks without a page_size, so
 * the backend default (100) silently truncated it — a batch-pin of a 200-row
 * page left pins #101+ rendered nowhere (they are filtered out of the main
 * grid AND absent from the dock). The reorder is equally load-bearing: it
 * sends only the ids of the bookmarks the dock loaded, so a truncated dock
 * left every unloaded pinned row with stale/colliding pin_order. This hook
 * walks ALL cursor pages so the dock always renders the complete pinned set.
 *
 * The query key keeps the 'bookmarks' prefix so the shared
 * resetQueries-on-mutation cache discipline applies to it as well.
 */
export function useAllPinnedBookmarks(sort: BookmarkQueryParams['sort']) {
  return useQuery({
    queryKey: ['bookmarks', 'all-pinned', sort],
    queryFn: async (): Promise<BookmarkDTO[]> => {
      const collected: BookmarkDTO[] = []
      let cursor: string | undefined = undefined
      for (;;) {
        const page = await bookmarksService.getBookmarks({
          sort,
          pinned: true,
          page_cursor: cursor,
        })
        collected.push(...page.bookmarks)
        if (!page.meta?.has_more || !page.meta.next_cursor) break
        cursor = page.meta.next_cursor
      }
      return collected
    },
    staleTime: 5 * 60 * 1000,
    gcTime: 24 * 60 * 60 * 1000,
    refetchOnWindowFocus: true,
  })
}
