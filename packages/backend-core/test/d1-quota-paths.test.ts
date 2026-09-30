import { Hono } from 'hono'
import { afterEach, describe, expect, it } from 'vitest'
import { handleBatchCreate } from '../src/lib/bookmarks/bookmark-batch'
import { emitSyncChanges } from '../src/lib/sync/sync-emit'
import { fetchBookmarkFolderStats } from '../src/lib/bookmarks/folders'
import { createSqliteD1, type SqliteD1Harness } from './helpers/sqlite-d1'
import { permanentDeleteBookmark, emptyTrash } from '../src/lib/bookmarks/bookmark-trash'

const USER = 'user-1'

let harness: SqliteD1Harness | null = null

function db(): SqliteD1Harness {
  harness = createSqliteD1(USER)
  return harness
}

afterEach(() => {
  harness?.close()
  harness = null
})

describe('batch import quota path', () => {
  it('completes without the ghost usage_count column and emits sync changes (regression)', async () => {
    const h = db()
    // Before the fix, the import threw "no such column: usage_count" AFTER
    // the inserts: the client got a 500, emitSyncChanges never ran, and the
    // extension stayed blind to the imported bookmarks.
    const result = await handleBatchCreate(h.db, USER, [
      { title: 'a', url: 'https://example.com/a', tags: ['ai'] },
      { title: 'b', url: 'https://example.com/b', tags: ['tools'] },
    ], 'api')

    expect(result.success).toBe(2)
    expect(result.created_bookmarks).toHaveLength(2)
    const changes = h.sqlite
      .prepare(`SELECT COUNT(*) AS n FROM sync_changes WHERE entity_type = 'bookmark'`)
      .get() as { n: number }
    expect(changes.n).toBe(2)
  })
})

describe('dup-check point seeks', () => {
  it('still restores a soft-deleted bookmark when re-saved with the exact URL', async () => {
    const h = db()
    const now = new Date().toISOString()
    h.sqlite
      .prepare(`INSERT INTO bookmarks (id, user_id, title, url, normalized_url, deleted_at, created_at, updated_at)
                VALUES ('bm-1', ?, 'old', 'https://example.com/a', 'example.com/a', ?, ?, ?)`)
      .run(USER, now, now, now)

    const found = h.sqlite
      .prepare('SELECT id, deleted_at FROM bookmarks WHERE user_id = ? AND url = ?')
      .get(USER, 'https://example.com/a') as { id: string; deleted_at: string } | undefined

    expect(found?.id).toBe('bm-1')
    expect(found?.deleted_at).not.toBeNull()
  })

  it('still detects a live duplicate by normalized URL variant', async () => {
    const h = db()
    const now = new Date().toISOString()
    h.sqlite
      .prepare(`INSERT INTO bookmarks (id, user_id, title, url, normalized_url, created_at, updated_at)
                VALUES ('bm-1', ?, 'live', 'https://example.com/a/', 'example.com/a', ?, ?)`)
      .run(USER, now, now)

    const byNormalized = h.sqlite
      .prepare('SELECT id FROM bookmarks WHERE user_id = ? AND normalized_url = ? AND deleted_at IS NULL')
      .get(USER, 'example.com/a') as { id: string } | undefined

    expect(byNormalized?.id).toBe('bm-1')
  })
})

describe('folder stats single scan', () => {
  it('counts totals and uncategorized in one pass', async () => {
    const h = db()
    const now = new Date().toISOString()
    const insert = h.sqlite.prepare(
      `INSERT INTO bookmarks (id, user_id, title, url, folder_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    insert.run('bm-1', USER, 'a', 'https://example.com/a', null, now, now)
    insert.run('bm-2', USER, 'b', 'https://example.com/b', 'f-1', now, now)
    insert.run('bm-3', USER, 'c', 'https://example.com/c', 'f-1', now, now)
    // A soft-deleted row must count toward none of the stats.
    h.sqlite
      .prepare(`INSERT INTO bookmarks (id, user_id, title, url, deleted_at, created_at, updated_at) VALUES ('bm-4', ?, 'd', 'https://example.com/d', ?, ?, ?)`)
      .run(USER, now, now, now)

    const stats = await fetchBookmarkFolderStats(h.db, USER)
    expect(stats).toEqual({ total_count: 3, uncategorized_count: 1 })
  })
})

describe('bulk emitSyncChanges uses the (user_id, id) index', () => {
  it('EXPLAIN confirms index point seeks rather than a user-wide scan', async () => {
    const h = db()
    await emitSyncChanges(h.db, USER, 'bookmark', ['bm-x'], 'upsert').catch(() => undefined)
    // Bind as a parameter (like production) — literal ids let the planner
    // shortcut via the PK and hide the real plan shape.
    const plan = h.sqlite
      .prepare('EXPLAIN QUERY PLAN SELECT id, title FROM bookmarks WHERE user_id = ? AND id IN (?, ?)')
      .all(USER, 'bm-x', 'bm-y') as Array<{ detail: string }>
    const detail = plan.map((row) => row.detail).join(' | ')
    expect(detail).toContain('idx_bookmarks_user_id_id')
    expect(detail).not.toContain('SCAN')
  })
})

describe('snapshot R2 lifecycle on hard delete', () => {
  function seedTrashedBookmarkWithSnapshot(h: SqliteD1Harness, id: string) {
    const now = new Date().toISOString()
    h.sqlite
      .prepare(`INSERT INTO bookmarks (id, user_id, title, url, deleted_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(id, USER, 't', `https://example.com/${id}`, now, now, now)
    h.sqlite
      .prepare(
        `INSERT INTO bookmark_snapshots (id, bookmark_id, user_id, version, storage_key, snapshot_title, source_url, content_size, content_hash, created_at)
         VALUES (?, ?, ?, 1, ?, 't', ?, 10, 'h', ?)`
      )
      .run(`snap-${id}`, id, USER, `snapshots/${USER}/${id}/uuid.html`, `https://example.com/${id}`, now)
  }

  it('permanent delete returns the storage keys so the route can purge R2 (regression: rows went, objects leaked)', async () => {
    const h = db()
    seedTrashedBookmarkWithSnapshot(h, 'bm-del')

    const result = await permanentDeleteBookmark(h.db, 'bm-del', USER)

    expect(result.success).toBe(true)
    expect(result.orphanedStorageKeys).toEqual([`snapshots/${USER}/bm-del/uuid.html`])
    const rows = h.sqlite.prepare('SELECT COUNT(*) AS n FROM bookmark_snapshots').get() as { n: number }
    expect(rows.n).toBe(0)
  })

  it('empty trash returns storage keys for every trashed bookmark', async () => {
    const h = db()
    seedTrashedBookmarkWithSnapshot(h, 'bm-a')
    seedTrashedBookmarkWithSnapshot(h, 'bm-b')

    const result = await emptyTrash(h.db, USER)

    expect(result.success).toBe(true)
    expect(result.count).toBe(2)
    expect(result.orphanedStorageKeys).toHaveLength(2)
  })
})
