import { describe, expect, it, vi, beforeEach } from 'vitest'
import { act, renderHook } from '@testing-library/react'

const state = {
  pages: [] as Array<{ bookmarks: Array<{ id: string }>; meta?: unknown }>,
  hasNextPage: false,
}

vi.mock('@/hooks/useBookmarks', () => ({
  useInfiniteBookmarks: () => ({
    data: { pages: state.pages },
    hasNextPage: state.hasNextPage,
    isFetchingNextPage: false,
    isLoading: false,
    isError: false,
    fetchNextPage: vi.fn(async () => ({ error: null })),
    refetch: vi.fn(),
  }),
}))

const { usePagedBookmarks } = await import('@/pages/bookmarks/hooks/usePagedBookmarks')

function page(...ids: string[]) {
  return { bookmarks: ids.map((id) => ({ id })), meta: {} }
}

beforeEach(() => {
  state.pages = [page('a', 'b'), page('c', 'd'), page('e', 'f')]
  state.hasNextPage = false
})

describe('paged bookmarks', () => {
  it('walks forward and back through cached pages', async () => {
    const { result, rerender } = renderHook(() => usePagedBookmarks({}, 2))

    expect(result.current.bookmarks.map((b) => b.id)).toEqual(['a', 'b'])
    await act(async () => { await result.current.pagination.onNextPage() })
    rerender()
    expect(result.current.bookmarks.map((b) => b.id)).toEqual(['c', 'd'])

    act(() => { result.current.pagination.onPreviousPage() })
    rerender()
    expect(result.current.bookmarks.map((b) => b.id)).toEqual(['a', 'b'])
  })

  // Regression: a mutation that shrinks the result set (batch-deleting a whole
  // page) left pageIndex past the end, so the user saw an empty list with no
  // way forward and no indication anything was wrong.
  it('clamps to the last page when the result set shrinks', async () => {
    const { result, rerender } = renderHook(() => usePagedBookmarks({}, 2))

    await act(async () => { await result.current.pagination.onNextPage() })
    await act(async () => { await result.current.pagination.onNextPage() })
    rerender()
    expect(result.current.pagination.currentPage).toBe(3)

    // Two pages worth of bookmarks are deleted and the query refetches.
    state.pages = [page('a', 'b')]
    rerender()

    expect(result.current.bookmarks.map((b) => b.id)).toEqual(['a', 'b'])
    expect(result.current.pagination.currentPage).toBe(1)
    expect(result.current.pagination.hasNextPage).toBe(false)
  })

  it('reports an empty page without crashing when everything is deleted', () => {
    state.pages = []
    const { result } = renderHook(() => usePagedBookmarks({}, 2))

    expect(result.current.bookmarks).toEqual([])
    expect(result.current.pagination.currentPage).toBe(1)
    expect(result.current.pagination.hasPreviousPage).toBe(false)
  })
})
