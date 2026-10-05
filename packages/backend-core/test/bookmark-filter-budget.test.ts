import { describe, expect, it } from 'vitest'
import {
  BookmarkFilterLimitError,
  buildBookmarkListQueries,
} from '../src/lib/bookmarks/bookmark-list'
import { fetchRelatedTagIds } from '../src/lib/bookmarks/bookmark-list-fetch'

/**
 * R8 BL-2 回归网:folder/tags/keyword/cursor 的参数总和必须落在 D1 每查询
 * 100 绑定参数预算内——固定 99 的 folder 上限让 folder_id=99 单独使用即 102
 * 参数:本地 SQLite(上限 999)全绿,真实 D1 上必 500。超限现在抛
 * BookmarkFilterLimitError(路由映射 400)。
 */
function ids(n: number): string {
  return Array.from({ length: n }, (_, i) => `f${i + 1}`).join(',')
}

function build(url: string) {
  return buildBookmarkListQueries('user-1', new URL(`https://tmarks.local/bookmarks${url}`))
}

function stubDb() {
  const captured: { params: unknown[] }[] = []
  const db = {
    prepare() {
      return {
        bind: (...params: unknown[]) => {
          captured.push({ params })
          return { all: async () => ({ results: [] }) }
        },
      }
    },
  } as unknown as Parameters<typeof fetchRelatedTagIds>[0]
  return { db, captured }
}

describe('bookmark list filter parameter budget (R8 BL-2)', () => {
  it('default view: 97 folder ids build at exactly the 100-param boundary', () => {
    const { arms } = build(`?folder_id=${ids(97)}`)
    expect(arms).toHaveLength(2)
    expect(Math.max(...arms.map((a) => a.params.length))).toBe(100)
  })

  it('default view: 98 folder ids throw instead of a guaranteed 500 on real D1', () => {
    expect(() => build(`?folder_id=${ids(98)}`)).toThrow(BookmarkFilterLimitError)
    expect(() => build(`?folder_id=${ids(98)}`)).toThrow(/max 97/)
  })

  it('keyword narrows the folder cap (94 ok / 95 throws)', () => {
    expect(() => build(`?keyword=foo&folder_id=${ids(94)}`)).not.toThrow()
    expect(() => build(`?keyword=foo&folder_id=${ids(95)}`)).toThrow(BookmarkFilterLimitError)
  })

  it('40 tags cap list-arm folders at 55 (55 ok / 56 throws)', () => {
    const tags = Array.from({ length: 40 }, (_, i) => `t${i + 1}`).join(',')
    expect(() => build(`?tags=${tags}&folder_id=${ids(55)}`)).not.toThrow()
    expect(() => build(`?tags=${tags}&folder_id=${ids(56)}`)).toThrow(BookmarkFilterLimitError)
  })

  it('pinned-row cursor narrows the folder cap to 92', () => {
    const cursor = encodeURIComponent(
      JSON.stringify({ id: 'bm-2', isPinned: true, pinOrder: 3, sortValue: '2024-01-02T00:00:00.000Z' }),
    )
    expect(() => build(`?page_cursor=${cursor}&folder_id=${ids(92)}`)).not.toThrow()
    expect(() => build(`?page_cursor=${cursor}&folder_id=${ids(93)}`)).toThrow(BookmarkFilterLimitError)
  })

  it('manual sort keeps the historical 98-folder budget (single arm)', () => {
    expect(() => build(`?sort=manual&folder_id=${ids(98)}`)).not.toThrow()
    expect(() => build(`?sort=manual&folder_id=${ids(99)}`)).toThrow(BookmarkFilterLimitError)
  })

  it('combined filters stay within the platform limit on every arm', () => {
    const { arms } = build(`?keyword=k&tags=t1,t2,t3&folder_id=${ids(80)}&page_cursor=legacy`)
    for (const arm of arms) expect(arm.params.length).toBeLessThanOrEqual(100)
  })

  it('related-tags arm: 40 tags cap folders at 18; 19 folders throw before binding', async () => {
    const tags = Array.from({ length: 40 }, (_, i) => `t${i + 1}`)
    const { db, captured } = stubDb()
    await expect(fetchRelatedTagIds(db, 'user-1', tags, ids(18), null)).resolves.toEqual([])
    // user + 2×40 tag ids + 18 folder ids + count = 100 — the exact platform boundary.
    expect(captured[0]!.params).toHaveLength(100)
    await expect(fetchRelatedTagIds(db, 'user-1', tags, ids(19), null)).rejects.toThrow(BookmarkFilterLimitError)
  })
})
