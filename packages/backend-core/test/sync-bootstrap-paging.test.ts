import { describe, expect, it } from 'vitest'
import { bootstrapSyncChanges } from '../src/lib/sync/sync-bootstrap'
import { emitSyncChange } from '../src/lib/sync/sync-emit'
import { createSqliteD1, type SqliteD1Harness } from './helpers/sqlite-d1'

const USER = 'user-1'

function seed(h: SqliteD1Harness, counts: { bookmarks?: number; folders?: number; tags?: number; groups?: number; items?: number }) {
  h.sqlite.exec('BEGIN')
  for (let i = 0; i < (counts.folders ?? 0); i += 1) {
    h.sqlite.prepare('INSERT INTO bookmark_folders (id,user_id,name) VALUES (?,?,?)').run(`f${String(i).padStart(5, '0')}`, USER, `Folder ${i}`)
  }
  for (let i = 0; i < (counts.tags ?? 0); i += 1) {
    h.sqlite.prepare('INSERT INTO tags (id,user_id,name) VALUES (?,?,?)').run(`t${String(i).padStart(5, '0')}`, USER, `tag-${i}`)
  }
  for (let i = 0; i < (counts.bookmarks ?? 0); i += 1) {
    h.sqlite.prepare('INSERT INTO bookmarks (id,user_id,title,url) VALUES (?,?,?,?)').run(`b${String(i).padStart(5, '0')}`, USER, `Bookmark ${i}`, `https://example.com/${i}`)
  }
  for (let i = 0; i < (counts.groups ?? 0); i += 1) {
    h.sqlite.prepare('INSERT INTO tab_groups (id,user_id,title) VALUES (?,?,?)').run(`g${String(i).padStart(5, '0')}`, USER, `Group ${i}`)
  }
  for (let i = 0; i < (counts.items ?? 0); i += 1) {
    h.sqlite.prepare('INSERT INTO tab_group_items (id,group_id,title,url,position) VALUES (?,?,?,?,?)').run(`i${String(i).padStart(5, '0')}`, 'g00000', `Item ${i}`, `https://example.com/i${i}`, i)
  }
  h.sqlite.exec('COMMIT')
}

/** Walks every bootstrap page the way the client does. */
async function walk(h: SqliteD1Harness, pageSize: number) {
  const collected = { bookmarks: [] as string[], bookmark_folders: [] as string[], tags: [] as string[], tab_groups: [] as string[], tab_group_items: [] as string[], preferences: [] as string[] }
  let pageCursor: string | null = null
  let pages = 0
  let cursor = ''

  for (;;) {
    const page = await bootstrapSyncChanges(h.db, USER, { pageCursor, pageSize })
    pages += 1
    cursor = page.cursor
    for (const key of Object.keys(collected) as (keyof typeof collected)[]) {
      collected[key].push(...page[key].map((c) => c.entity_id))
    }
    if (!page.has_more) break
    expect(page.page_cursor, 'has_more implies a page cursor').toBeTruthy()
    pageCursor = page.page_cursor
    if (pages > 500) throw new Error('bootstrap pagination did not terminate')
  }
  return { collected, pages, cursor }
}

describe('paginated bootstrap', () => {
  it('delivers every entity exactly once across pages', async () => {
    const h = createSqliteD1(USER)
    seed(h, { folders: 7, tags: 11, bookmarks: 53, groups: 5, items: 23 })

    for (const pageSize of [1, 2, 7, 10, 99, 5000]) {
      const { collected } = await walk(h, pageSize)
      expect(collected.bookmark_folders.length, `page_size=${pageSize}`).toBe(7)
      expect(collected.tags.length, `page_size=${pageSize}`).toBe(11)
      expect(collected.bookmarks.length, `page_size=${pageSize}`).toBe(53)
      expect(collected.tab_groups.length, `page_size=${pageSize}`).toBe(5)
      expect(collected.tab_group_items.length, `page_size=${pageSize}`).toBe(23)
      // No duplicates, which would mean an overlapping page window.
      expect(new Set(collected.bookmarks).size, `page_size=${pageSize}`).toBe(53)
    }
    h.close()
  })

  it('actually splits a large account into pages', async () => {
    const h = createSqliteD1(USER)
    seed(h, { bookmarks: 100 })

    const { pages, collected } = await walk(h, 10)
    expect(pages).toBeGreaterThan(1)
    expect(collected.bookmarks.length).toBe(100)
    h.close()
  })

  it('sends preferences only on the final page', async () => {
    const h = createSqliteD1(USER)
    h.sqlite.prepare('INSERT INTO user_preferences (user_id) VALUES (?)').run(USER)
    seed(h, { bookmarks: 30 })

    let pageCursor: string | null = null
    const seen: number[] = []
    for (;;) {
      const page = await bootstrapSyncChanges(h.db, USER, { pageCursor, pageSize: 10 })
      seen.push(page.preferences.length)
      if (!page.has_more) break
      pageCursor = page.page_cursor
    }
    expect(seen.slice(0, -1).every((n) => n === 0), 'preferences must not appear early').toBe(true)
    expect(seen[seen.length - 1]).toBe(1)
    h.close()
  })

  it('keeps one sync cursor for the whole walk', async () => {
    const h = createSqliteD1(USER)
    seed(h, { bookmarks: 30 })

    const first = await bootstrapSyncChanges(h.db, USER, { pageSize: 10 })
    // A write landing mid-walk must not move the cursor the client will store,
    // otherwise that change is both absent from the snapshot and below the
    // saved cursor — invisible until the next bootstrap.
    await emitSyncChange(h.db, USER, 'bookmark', 'b00000', 'upsert')
    const second = await bootstrapSyncChanges(h.db, USER, { pageCursor: first.page_cursor, pageSize: 10 })

    expect(second.cursor).toBe(first.cursor)
    h.close()
  })

  it('restarts cleanly from a malformed page cursor', async () => {
    const h = createSqliteD1(USER)
    seed(h, { bookmarks: 5 })

    const page = await bootstrapSyncChanges(h.db, USER, { pageCursor: 'not-a-token', pageSize: 100 })
    expect(page.bookmarks).toHaveLength(5)
    expect(page.has_more).toBe(false)
    h.close()
  })

  it('reports completion for an empty account', async () => {
    const h = createSqliteD1(USER)
    const page = await bootstrapSyncChanges(h.db, USER, { pageSize: 10 })
    expect(page.has_more).toBe(false)
    expect(page.page_cursor).toBeNull()
    h.close()
  })

  it('carries the server-maintained bookmark_count on tag pages', async () => {
    const h = createSqliteD1(USER)
    seed(h, { tags: 3, bookmarks: 2 })
    // One live link: the maintained counter (triggers) makes t00001 count 1.
    // The extension's AI sampling and popup tag ordering read this payload
    // field; without it every tag arrives with bookmark_count 0 and the
    // model is told the most-used tags have zero bookmarks.
    h.sqlite
      .prepare('INSERT INTO bookmark_tags (bookmark_id, tag_id, user_id) VALUES (?, ?, ?)')
      .run('b00000', 't00001', USER)

    const page = await bootstrapSyncChanges(h.db, USER, { pageSize: 10 })
    const linked = page.tags.find((change) => change.entity_id === 't00001')
    const unlinked = page.tags.find((change) => change.entity_id === 't00000')
    expect((linked?.payload as Record<string, unknown>).bookmark_count).toBe(1)
    expect((unlinked?.payload as Record<string, unknown>).bookmark_count).toBe(0)
    h.close()
  })
})
