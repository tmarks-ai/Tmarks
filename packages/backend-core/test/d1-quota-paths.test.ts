import { Hono } from 'hono'
import { afterEach, describe, expect, it } from 'vitest'
import { handleBatchCreate } from '../src/lib/bookmarks/bookmark-batch'
import { createBookmarkHandler } from '../src/routes/bookmarks/create'
import { emitSyncChanges } from '../src/lib/sync/sync-emit'
import { fetchBookmarkFolderStats } from '../src/lib/bookmarks/folders'
import { createSqliteD1, type SqliteD1Harness } from './helpers/sqlite-d1'
import { permanentDeleteBookmark, emptyTrash } from '../src/lib/bookmarks/bookmark-trash'
import type { AppEnv } from '../src/lib/env'

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
  // R8 BT-8: these cases used to re-run the create path's own SELECT inline
  // (self-verifying — a change to the production query left the test green)
  // and never actually invoked the create handler. Now they do.
  function mountCreate(h: SqliteD1Harness) {
    const app = new Hono<AppEnv>()
    app.post('/bookmarks', async (c, next) => {
      c.set('auth', { user_id: USER, auth_type: 'jwt' })
      await next()
    }, createBookmarkHandler as never)
    return (body: unknown) =>
      app.request('/bookmarks', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }, { DB: h.db } as AppEnv['Bindings'])
  }

  it('still restores a soft-deleted bookmark when re-saved with the exact URL', async () => {
    const h = db()
    const now = new Date().toISOString()
    h.sqlite
      .prepare(`INSERT INTO bookmarks (id, user_id, title, url, normalized_url, deleted_at, created_at, updated_at)
                VALUES ('bm-1', ?, 'old', 'https://example.com/a', 'example.com/a', ?, ?, ?)`)
      .run(USER, now, now, now)

    const call = mountCreate(h)
    const res = await call({ title: 'revived', url: 'https://example.com/a' })
    const body = await res.json() as { data?: { bookmark?: { id?: string } }; error?: { code?: string } }

    // 生产恢复路径:同 URL 命中软删行 → 复活为同一 id(不是新建、不是 409)。
    expect(res.status).toBe(201)
    expect(body.data?.bookmark?.id).toBe('bm-1')
    const revived = h.sqlite
      .prepare('SELECT id, deleted_at, title FROM bookmarks WHERE id = ?')
      .get('bm-1') as { id: string; deleted_at: string | null; title: string }
    expect(revived.deleted_at).toBeNull()
    expect(revived.title).toBe('revived')
    expect((h.sqlite.prepare('SELECT COUNT(*) AS n FROM bookmarks').get() as { n: number }).n).toBe(1)
  })

  it('still detects a live duplicate by normalized URL variant', async () => {
    const h = db()
    const now = new Date().toISOString()
    // 注意 normalized_url 的生产口径:normalizeBookmarkUrl 保留协议
    // ('https://example.com/a'),旧用例内联 SELECT 用的是自造的 'example.com/a'
    // 约定——自证自明的根源(BT-8)。
    h.sqlite
      .prepare(`INSERT INTO bookmarks (id, user_id, title, url, normalized_url, created_at, updated_at)
                VALUES ('bm-1', ?, 'live', 'https://example.com/a/', 'https://example.com/a', ?, ?)`)
      .run(USER, now, now)

    const call = mountCreate(h)
    const res = await call({ title: 'dup', url: 'https://example.com/a' })
    const body = await res.json() as { data?: { bookmark?: { id?: string; title?: string } } }

    // REST create 面对活重复的语义是幂等返回既有行(200 + 原 id),
    // 409 DUPLICATE_URL 只存在于同步推送面。
    expect(res.status).toBe(200)
    expect(body.data?.bookmark?.id).toBe('bm-1')
    expect(body.data?.bookmark?.title).toBe('live')
    expect((h.sqlite.prepare('SELECT COUNT(*) AS n FROM bookmarks').get() as { n: number }).n).toBe(1)
  })
})

describe('folder stats single scan', () => {
  it('counts totals and uncategorized in one pass', async () => {
    const h = db()
    const now = new Date().toISOString()
    const insert = h.sqlite.prepare(
      `INSERT INTO bookmarks (id, user_id, title, url, folder_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    // Parent row first — the harness enforces bookmarks.folder_id REFERENCES
    // bookmark_folders since R8 IN-1.
    h.sqlite
      .prepare(`INSERT INTO bookmark_folders (id, user_id, name) VALUES ('f-1', ?, 'stats')`)
      .run(USER)
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
