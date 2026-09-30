import { useCallback, useMemo, useState } from 'react'
import type { BookmarkDTO } from '@tmarks/contracts'

/**
 * Batch selection that survives pagination.
 *
 * Selection deliberately persists while the user pages through results, so the
 * selected ids routinely refer to bookmarks that are no longer in the rendered
 * page. Deriving the selected entities by filtering the current page therefore
 * silently dropped everything picked on earlier pages — the batch action ran on
 * a subset while the toast reported the full count. Keeping the entities
 * themselves is what makes the two consistent.
 */
export function useBookmarkSelection() {
  const [selected, setSelected] = useState<Record<string, BookmarkDTO>>({})

  const selectedIds = useMemo(() => Object.keys(selected), [selected])
  const selectedBookmarks = useMemo(() => Object.values(selected), [selected])

  const toggle = useCallback((bookmark: BookmarkDTO) => {
    setSelected((current) => {
      if (current[bookmark.id]) {
        const { [bookmark.id]: _removed, ...rest } = current
        return rest
      }
      return { ...current, [bookmark.id]: bookmark }
    })
  }, [])

  const selectAll = useCallback((bookmarks: BookmarkDTO[]) => {
    setSelected((current) => {
      const next = { ...current }
      for (const bookmark of bookmarks) next[bookmark.id] = bookmark
      return next
    })
  }, [])

  const clear = useCallback(() => setSelected({}), [])

  return { selectedIds, selectedBookmarks, toggle, selectAll, clear }
}
