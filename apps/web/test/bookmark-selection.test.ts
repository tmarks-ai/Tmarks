import { describe, expect, it } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import type { BookmarkDTO } from '@tmarks/contracts'
import { useBookmarkSelection } from '@/pages/bookmarks/hooks/useBookmarkSelection'

function bookmark(id: string, overrides: Partial<BookmarkDTO> = {}): BookmarkDTO {
  return {
    id,
    title: `Bookmark ${id}`,
    url: `https://example.com/${id}`,
    description: null,
    folder_id: null,
    folder_path: [],
    cover_image: null,
    favicon: null,
    is_pinned: false,
    is_todo: false,
    is_archived: false,
    is_private: false,
    click_count: 0,
    tags: [],
    created_at: '2024-01-01T00:00:00.000Z',
    updated_at: '2024-01-01T00:00:00.000Z',
    ...overrides,
  } as BookmarkDTO
}

describe('batch selection across pages', () => {
  // Regression: selection deliberately survives paging, but the action bar
  // re-derived the selected entities by filtering the *current page*. Items
  // picked on earlier pages were silently dropped from the request while the
  // success toast still reported the full count.
  it('keeps bookmarks selected on earlier pages', () => {
    const { result } = renderHook(() => useBookmarkSelection())

    const page1 = [bookmark('a'), bookmark('b')]
    const page2 = [bookmark('c')]

    act(() => {
      page1.forEach((b) => result.current.toggle(b))
    })
    act(() => {
      page2.forEach((b) => result.current.toggle(b))
    })

    expect(result.current.selectedIds.sort()).toEqual(['a', 'b', 'c'])
    // The entities are carried, so a batch action can act on all three even
    // though only page 2 is rendered.
    expect(result.current.selectedBookmarks.map((b) => b.id).sort()).toEqual(['a', 'b', 'c'])
  })

  it('keeps ids and entities in step so counts cannot disagree', () => {
    const { result } = renderHook(() => useBookmarkSelection())

    act(() => {
      result.current.selectAll([bookmark('a'), bookmark('b'), bookmark('c')])
    })
    act(() => {
      result.current.toggle(bookmark('b'))
    })

    expect(result.current.selectedIds).toHaveLength(2)
    expect(result.current.selectedBookmarks).toHaveLength(2)
    expect(result.current.selectedBookmarks.map((b) => b.id).sort()).toEqual(['a', 'c'])
  })

  it('does not duplicate an entry when select-all overlaps an existing pick', () => {
    const { result } = renderHook(() => useBookmarkSelection())

    act(() => {
      result.current.toggle(bookmark('a'))
    })
    act(() => {
      result.current.selectAll([bookmark('a'), bookmark('b')])
    })

    expect(result.current.selectedIds.sort()).toEqual(['a', 'b'])
  })

  it('clears everything, including picks from other pages', () => {
    const { result } = renderHook(() => useBookmarkSelection())

    act(() => {
      result.current.selectAll([bookmark('a'), bookmark('b')])
    })
    act(() => {
      result.current.clear()
    })

    expect(result.current.selectedIds).toEqual([])
    expect(result.current.selectedBookmarks).toEqual([])
  })

  it('exposes a stable clear identity so effects do not loop', () => {
    const { result, rerender } = renderHook(() => useBookmarkSelection())
    const first = result.current.clear
    rerender()
    expect(result.current.clear).toBe(first)
  })
})
