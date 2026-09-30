import { describe, expect, it } from 'vitest'
import { buildBookmarkListQueries } from '../src/lib/bookmarks/bookmark-list'

function build(url: string) {
  return buildBookmarkListQueries('user-1', new URL(`https://tmarks.local/bookmarks${url}`))
}

function flat(arms: ReturnType<typeof build>['arms']) {
  return arms.map((arm) => arm.query).join('\n--ARM--\n')
}

describe('bookmark list two-arm query (status param)', () => {
  it('default view builds a pinned arm and an unpinned arm', () => {
    const { arms } = build('')
    expect(arms).toHaveLength(2)
    expect(arms[0]!.query).toContain('AND b.is_pinned = ?')
    expect(arms[0]!.params).toEqual(['user-1', 1, 101])
    expect(arms[1]!.params).toEqual(['user-1', 0, 101])
    // Each arm orders by its own segment key — no cross-segment CASE.
    expect(flat(arms)).not.toContain('CASE WHEN')
  })

  it('maps each known status to its column clause in both arms', () => {
    const sql = flat(build('?status=todo').arms)
    expect(sql).toContain('AND b.is_todo = 1')
    expect((sql.match(/AND b\.is_todo = 1/g) || [])).toHaveLength(2)
  })

  it('status=pinned collapses to the single pinned arm', () => {
    const { arms } = build('?status=pinned')
    expect(arms).toHaveLength(1)
    expect(arms[0]!.params).toEqual(['user-1', 1, 101])
  })

  it('keeps the legacy pinned=false param as the single unpinned arm', () => {
    const { arms } = build('?pinned=false')
    expect(arms).toHaveLength(1)
    expect(arms[0]!.params).toEqual(['user-1', 0, 101])
  })

  it('contradictory pinned=false + status=pinned stays empty (legacy behavior)', () => {
    const { arms } = build('?pinned=false&status=pinned')
    expect(arms).toHaveLength(1)
    expect(arms[0]!.query).toContain('b.is_pinned = ? AND b.is_pinned = 1')
    expect(arms[0]!.params).toEqual(['user-1', 0, 101])
  })

  it('combines status with keyword, folder and tags in stable param order', () => {
    const { arms } = build('?status=todo&keyword=foo&folder_id=a,b&tags=t1,t2')
    expect(arms).toHaveLength(2)
    const arm = arms[0]!
    expect(arm.query.indexOf('AND b.is_todo = 1')).toBeLessThan(arm.query.indexOf('LIKE'))
    expect(arm.query).toContain('AND b.id IN (')
    // The tag subquery is user-scoped (bt.user_id = ?) before the tag ids, so
    // the user param precedes t1/t2 in bind order.
    expect(arm.query).toContain('WHERE bt.user_id = ? AND bt.tag_id IN (')
    expect(arm.query).toContain('HAVING COUNT(DISTINCT bt.tag_id) = ?')
    expect(arm.params).toEqual(['user-1', 1, '%foo%', '%foo%', '%foo%', 'a', 'b', 'user-1', 't1', 't2', 2, 101])
  })

  it('manual sort stays a single legacy-shaped arm', () => {
    const { arms } = build('?sort=manual')
    expect(arms).toHaveLength(1)
    expect(arms[0]!.query).toContain('ORDER BY b.position ASC, b.id ASC')
    expect(arms[0]!.query).not.toContain('b.is_pinned = ?')
  })
})

describe('bookmark list two-arm cursor pagination', () => {
  const unpinnedCursor = JSON.stringify({ id: 'bm-9', isPinned: false, pinOrder: null, sortValue: '2024-01-01T00:00:00.000Z' })
  const pinnedCursor = JSON.stringify({ id: 'bm-2', isPinned: true, pinOrder: 3, sortValue: '2024-01-02T00:00:00.000Z' })

  it('a cursor on an unpinned row skips the pinned arm entirely', () => {
    const { arms } = build(`?page_cursor=${encodeURIComponent(unpinnedCursor)}`)
    expect(arms).toHaveLength(1)
    expect(arms[0]!.params[1]).toBe(0)
    expect(arms[0]!.query).toContain('AND (b.created_at < ? OR (b.created_at = ? AND b.id < ?))')
    expect(arms[0]!.params).toEqual(['user-1', 0, '2024-01-01T00:00:00.000Z', '2024-01-01T00:00:00.000Z', 'bm-9', 101])
  })

  it('a cursor on a pinned row continues the pinned arm and restarts the unpinned arm', () => {
    const { arms } = build(`?page_cursor=${encodeURIComponent(pinnedCursor)}`)
    expect(arms).toHaveLength(2)
    expect(arms[0]!.params[1]).toBe(1)
    expect(arms[0]!.query).toContain('b.pin_order > ?')
    expect(arms[0]!.params.slice(2, 7)).toEqual([3, 3, '2024-01-02T00:00:00.000Z', '2024-01-02T00:00:00.000Z', 'bm-2'])
    // unpinned arm has no cursor predicate (fresh segment)
    expect(arms[1]!.query).not.toContain('b.pin_order > ?')
    expect(arms[1]!.query).not.toContain('b.created_at < ?')
    expect(arms[1]!.params).toEqual(['user-1', 0, 101])
  })

  it('uses the pin_order continuation when filtering by pinned status', () => {
    const { arms } = build(`?status=pinned&page_cursor=${encodeURIComponent(pinnedCursor)}`)
    expect(arms).toHaveLength(1)
    expect(arms[0]!.query).toContain('b.pin_order > ?')
  })

  it('falls back to the legacy raw cursor branch for unrecognized cursors', () => {
    const { arms } = build('?status=archived&page_cursor=legacy')
    expect((flat(arms).match(/AND b\.id < \?/g) || [])).toHaveLength(2)
    expect(arms[0]!.params.slice(-2)).toEqual(['legacy', 101])
  })

  it('ignores malformed JSON cursors instead of using the legacy id branch', () => {
    const { arms } = build(`?status=archived&page_cursor=${encodeURIComponent('{not-json')}`)
    expect(flat(arms)).toContain('AND b.is_archived = 1')
    expect(flat(arms)).not.toContain('AND b.id < ?')
  })

  it('ignores JSON cursors with an unexpected shape', () => {
    const { arms } = build('?page_cursor={"id":"bm-1"}')
    expect(flat(arms)).not.toContain('b.id < ?')
    expect(flat(arms)).not.toContain('b.pin_order > ?')
  })
})
