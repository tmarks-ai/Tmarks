import { describe, expect, it } from 'vitest'
import type { SqliteDatabase } from './helpers/sqlite-migrations'
import { buildBookmarkListQueries, createBookmarkPageCursor } from '../src/lib/bookmarks/bookmark-list'
import type { BookmarkListRow } from '../src/lib/bookmarks/bookmark-list'
import { createMigratedDatabase } from './helpers/sqlite-migrations'

const USER = 'user-1'

interface SeedSpec {
  id: string
  isPinned?: boolean
  pinOrder?: number
  isTodo?: boolean
  isArchived?: boolean
  createdAt: string
}

function seed(db: SqliteDatabase, rows: SeedSpec[]): void {
  // FK enforcement (R8 IN-1): the migrated harness enforces references now —
  // bookmarks reference the user row, so the parent must exist first.
  db.prepare(`INSERT OR IGNORE INTO users (id, username, password_hash) VALUES (?, ?, 'x')`).run(USER, USER)
  const insert = db.prepare(
    `INSERT INTO bookmarks (id, user_id, title, url, normalized_url, is_pinned, pin_order, is_todo, is_archived, position, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
  rows.forEach((row, index) => {
    insert.run(
      row.id,
      USER,
      `Title ${row.id}`,
      `https://example.com/${row.id}`,
      `https://example.com/${row.id}`,
      row.isPinned ? 1 : 0,
      row.pinOrder ?? 0,
      row.isTodo ? 1 : 0,
      row.isArchived ? 1 : 0,
      index,
      row.createdAt,
      row.createdAt
    )
  })
}

/**
 * Walks the cursor pagination exactly the way the route handler does, and
 * returns the ids in visit order. Throws if the generated SQL is invalid, which
 * is the whole point — a string-matching assertion cannot catch an unbalanced
 * paren, but `prepare()` on real SQLite can.
 */
function paginate(db: SqliteDatabase, search: string, pageSize: number): string[] {
  const visited: string[] = []
  let cursor: string | null = null

  for (let page = 0; page < 50; page += 1) {
    const separator = search.includes('?') ? '&' : '?'
    const cursorPart = cursor ? `${separator}page_cursor=${encodeURIComponent(cursor)}` : ''
    const url = new URL(`https://tmarks.local/bookmarks${search}${cursorPart}`)
    const { arms, pageSize: limit, sortBy } = buildBookmarkListQueries(USER, url)

    // Same execution shape as the route handler: arms concatenated (pinned
    // segment first) reproduce the old single-query global order.
    const rows = arms.flatMap((arm) => {
      const boundParams = arm.params.map((param) => (param === null ? null : (param as string | number)))
      return db.prepare(arm.query).all(...boundParams) as unknown as BookmarkListRow[]
    })

    const hasMore = rows.length > limit
    const pageRows = hasMore ? rows.slice(0, limit) : rows
    visited.push(...pageRows.map((row) => row.id))

    if (!hasMore || pageRows.length === 0) return visited
    cursor = createBookmarkPageCursor(pageRows[pageRows.length - 1], sortBy)
  }

  throw new Error('pagination did not terminate within 50 pages')
}

function search(params: Record<string, string>): string {
  const query = new URLSearchParams(params).toString()
  return query ? `?${query}` : ''
}

describe('bookmark list pagination against real SQLite', () => {
  it('applies every migration cleanly', () => {
    const db = createMigratedDatabase()
    const columns = db
      .prepare('PRAGMA table_info(bookmarks)')
      .all()
      .map((row) => String((row as { name: unknown }).name))
    // Columns that the list cursor/order path depends on.
    expect(columns).toEqual(
      expect.arrayContaining(['folder_id', 'pin_order', 'is_todo', 'position', 'normalized_url', 'is_private'])
    )
    db.close()
  })

  // Regression: the `parsedCursor.isPinned` branch was missing a closing paren,
  // so any account whose pinned count reached the page size got a SQL syntax
  // error on page 2. Every branch is exercised here against real SQLite.
  it('walks all pages when pinned bookmarks fill the first page', () => {
    const db = createMigratedDatabase()
    seed(db, [
      { id: 'p1', isPinned: true, pinOrder: 1, createdAt: '2024-01-05T00:00:00.000Z' },
      { id: 'p2', isPinned: true, pinOrder: 2, createdAt: '2024-01-04T00:00:00.000Z' },
      { id: 'p3', isPinned: true, pinOrder: 3, createdAt: '2024-01-03T00:00:00.000Z' },
      { id: 'u1', createdAt: '2024-01-02T00:00:00.000Z' },
      { id: 'u2', createdAt: '2024-01-01T00:00:00.000Z' },
    ])

    // Page size 2 forces the cursor to land on a pinned row after page 1.
    expect(paginate(db, search({ page_size: '2' }), 2)).toEqual(['p1', 'p2', 'p3', 'u1', 'u2'])
    db.close()
  })

  it('visits every bookmark exactly once across every page size', () => {
    const db = createMigratedDatabase()
    const rows: SeedSpec[] = []
    for (let i = 0; i < 12; i += 1) {
      rows.push({
        id: `pin-${i}`,
        isPinned: true,
        pinOrder: i,
        createdAt: `2024-02-${String(i + 1).padStart(2, '0')}T00:00:00.000Z`,
      })
    }
    for (let i = 0; i < 15; i += 1) {
      rows.push({ id: `plain-${i}`, createdAt: `2024-01-${String(i + 1).padStart(2, '0')}T00:00:00.000Z` })
    }
    seed(db, rows)

    for (const pageSize of [1, 2, 3, 5, 10, 27, 100]) {
      const visited = paginate(db, search({ page_size: String(pageSize) }), pageSize)
      expect(new Set(visited).size, `page_size=${pageSize} produced duplicates`).toBe(rows.length)
      expect(visited.length, `page_size=${pageSize} lost or repeated rows`).toBe(rows.length)
    }
    db.close()
  })

  it('produces valid SQL for every sort and status branch', () => {
    const db = createMigratedDatabase()
    seed(db, [
      { id: 'a', isPinned: true, pinOrder: 1, isTodo: true, createdAt: '2024-01-03T00:00:00.000Z' },
      { id: 'b', isTodo: true, isArchived: true, createdAt: '2024-01-02T00:00:00.000Z' },
      { id: 'c', createdAt: '2024-01-01T00:00:00.000Z' },
    ])

    for (const sort of ['created', 'updated', 'popular', 'manual']) {
      for (const status of ['all', 'todo', 'pinned', 'archived', 'private']) {
        for (const pinned of ['', 'true', 'false']) {
          const params: Record<string, string> = { sort, page_size: '1' }
          if (status !== 'all') params.status = status
          if (pinned) params.pinned = pinned
          expect(() => paginate(db, search(params), 1), `sort=${sort} status=${status} pinned=${pinned}`).not.toThrow()
        }
      }
    }
    db.close()
  })

  it('visits same-millisecond created_at ties exactly once (id tiebreaker)', () => {
    const db = createMigratedDatabase()
    const sameMs = '2024-03-01T00:00:00.000Z'
    const rows: SeedSpec[] = [
      { id: 'tie-e', isPinned: true, pinOrder: 1, createdAt: sameMs },
      { id: 'tie-a', createdAt: sameMs },
      { id: 'tie-b', createdAt: sameMs },
      { id: 'tie-c', createdAt: sameMs },
      { id: 'tie-d', createdAt: sameMs },
    ]
    seed(db, rows)

    for (const pageSize of [1, 2, 3]) {
      const visited = paginate(db, search({ page_size: String(pageSize) }), pageSize)
      expect(new Set(visited).size, `page_size=${pageSize} duplicates`).toBe(rows.length)
      expect(visited.length, `page_size=${pageSize} lost rows`).toBe(rows.length)
    }
    db.close()
  })

  it('both arms seek the (user_id, is_pinned) index prefix instead of scanning', () => {
    // The whole point of the two-arm split: D1 bills scanned rows, and the
    // old cross-segment CASE order matched no index. Pin the plans so a
    // future schema/index change cannot silently regress to full scans.
    const db = createMigratedDatabase()
    const plan = (sql: string, ...params: unknown[]) =>
      (db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...params) as Array<{ detail: string }>)
        .map((row) => row.detail)
        .join(' | ')

    for (const sort of ['b.created_at', 'b.updated_at', 'b.click_count']) {
      const detail = plan(
        `SELECT b.* FROM bookmarks b WHERE b.user_id = ? AND b.deleted_at IS NULL AND b.is_pinned = 0 ORDER BY ${sort} DESC, b.id DESC LIMIT 101`,
        USER
      )
      expect(detail, sort).toContain('is_pinned=?')
      expect(detail, sort).not.toContain('SCAN bookmarks')
    }

    const pinnedDetail = plan(
      `SELECT b.* FROM bookmarks b WHERE b.user_id = ? AND b.deleted_at IS NULL AND b.is_pinned = 1 ORDER BY b.pin_order ASC, b.created_at DESC, b.id DESC LIMIT 101`,
      USER
    )
    expect(pinnedDetail).toContain('idx_bookmarks_user_pinned_order')
    expect(pinnedDetail).not.toContain('SCAN bookmarks')
    db.close()
  })

  it('keeps keyword, folder and tag filters valid alongside a pinned cursor', () => {
    const db = createMigratedDatabase()
    seed(db, [
      { id: 'k1', isPinned: true, pinOrder: 1, createdAt: '2024-01-03T00:00:00.000Z' },
      { id: 'k2', isPinned: true, pinOrder: 2, createdAt: '2024-01-02T00:00:00.000Z' },
      { id: 'k3', createdAt: '2024-01-01T00:00:00.000Z' },
    ])
    db.prepare(`INSERT INTO tags (id, user_id, name) VALUES ('t1', ?, 'alpha')`).run(USER)
    db.prepare(`INSERT INTO bookmark_tags (bookmark_id, tag_id, user_id) VALUES ('k1', 't1', ?)`).run(USER)

    expect(() => paginate(db, search({ keyword: 'Title', page_size: '1' }), 1)).not.toThrow()
    expect(() => paginate(db, search({ folder_id: 'none', page_size: '1' }), 1)).not.toThrow()
    expect(() => paginate(db, search({ tags: 't1', page_size: '1' }), 1)).not.toThrow()
    db.close()
  })
})
