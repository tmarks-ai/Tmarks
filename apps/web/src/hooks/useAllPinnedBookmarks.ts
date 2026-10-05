import { useQuery } from '@tanstack/react-query'
import { bookmarksService } from '@/services/bookmarks'
import type { BookmarkDTO } from '@tmarks/contracts'

/**
 * R5-12: the pinned dock used the plain useBookmarks without a page_size, so
 * the backend default (100) silently truncated it — a batch-pin of a 200-row
 * page left pins #101+ rendered nowhere (they are filtered out of the main
 * grid AND absent from the dock). The reorder is equally load-bearing: it
 * sends only the ids of the bookmarks the dock loaded, so a truncated dock
 * left every unloaded pinned row with stale/colliding pin_order. This hook
 * walks ALL cursor pages so the dock always renders the complete pinned set.
 *
 * R8 WE-1: the fetch is pinned to a non-manual sort. The backend's manual arm
 * orders by row `position` (pin_order does not participate), so passing the
 * grid's sort through made a manual-mode dock render by grid order — drags
 * looked ineffective and the reorder then OVERWROTE the user's existing
 * pin_order with the position sequence. Any non-manual sort orders the
 * pinned arm by pin_order; pinned order is independent of the grid sort, so
 * one fixed key also shares a single cache entry across sort modes.
 *
 * The query key keeps the 'bookmarks' prefix so the shared
 * resetQueries-on-mutation cache discipline applies to it as well.
 */
export function useAllPinnedBookmarks() {
  return useQuery({
    queryKey: ['bookmarks', 'all-pinned'],
    queryFn: async (): Promise<BookmarkDTO[]> => {
      const collected: BookmarkDTO[] = []
      let cursor: string | undefined = undefined
      for (let page = 0; page < 50; page++) {
        const result = await bookmarksService.getBookmarks({
          sort: 'created',
          pinned: true,
          page_cursor: cursor,
        })
        collected.push(...result.bookmarks)
        if (!result.meta?.has_more || !result.meta.next_cursor) break
        cursor = result.meta.next_cursor
      }
      return collected
    },
    staleTime: 5 * 60 * 1000,
    gcTime: 24 * 60 * 60 * 1000,
    refetchOnWindowFocus: true,
  })
}
