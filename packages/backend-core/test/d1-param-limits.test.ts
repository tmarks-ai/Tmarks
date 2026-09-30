import { Hono } from 'hono'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { bulkBookmarksHandler } from '../src/routes/bookmarks/bulk'
import { reorderBookmarksHandler } from '../src/routes/bookmarks/reorder'
import { createBookmarkHandler } from '../src/routes/bookmarks/create'
import { searchHandler } from '../src/routes/search'
import { emptyTrash } from '../src/lib/bookmarks'
import { createSqliteD1, type SqliteD1Harness } from './helpers/sqlite-d1'
import { validateBookmarkPayload, validateTabGroupPayload } from '../src/lib/sync/sync-utils'
import type { AppEnv } from '../src/lib/env'

/**
 * D1 平台限制回归网（R5-1）:线上实锤过——100-id 批量在自家文档化上限处 500,
 * 95-id 正常;本地 SQLite(999/32k)不执行 D1 的"每查询 100 绑定参数",所以这些
 * 用例全部借道 helpers/sqlite-d1 里强制执行的 D1 限制。拆分修复(chunkForD1In)
 * 让以下每条都在文档化最大值上通过。
 */
const USER = 'user-1'

let harness: SqliteD1Harness | null = null

function db(): SqliteD1Harness {
  harness = createSqliteD1(USER)
  return harness
}

afterEach(() => {
  harness?.close()
  harness = null
  vi.unstubAllGlobals()
})

function mount(h: SqliteD1Harness, method: 'post' | 'get', path: string, handler: (c: never) => Promise<Response>) {
  const app = new Hono<AppEnv>()
  app.on(method, path, async (c, next) => {
    c.set('auth', { user_id: USER, auth_type: 'jwt' })
    await next()
  }, handler as never)
  return (body?: unknown, query = '') =>
    app.request(`http://localhost${path}${query}`, {
      ...(method === 'post' ? { method: 'POST', body: JSON.stringify(body) } : { method: 'GET' }),
    }, { DB: h.db } as AppEnv['Bindings'])
}

function seedBookmarks(h: SqliteD1Harness, count: number, options: { trashed?: boolean; keyword?: string } = {}) {
  const now = new Date().toISOString()
  const stmt = h.sqlite.prepare(
    `INSERT INTO bookmarks (id, user_id, title, url, created_at, updated_at, deleted_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  )
  h.sqlite.exec('BEGIN')
  for (let i = 0; i < count; i++) {
    stmt.run(`bm-${i}`, USER, options.keyword ? `t ${options.keyword}` : `t-${i}`, `https://example.com/a-${i}`, now, now, options.trashed ? now : null)
  }
  h.sqlite.exec('COMMIT')
}

describe('D1 100-bound-parameter platform limit', () => {
  it('the harness enforces the limit (guard is live)', () => {
    const h = db()
    const placeholders = Array.from({ length: 101 }, () => '?').join(',')
    expect(() => h.db.prepare(`SELECT 1 WHERE 1 IN (${placeholders})`).bind(...Array.from({ length: 101 }, (_, i) => i))).toThrow(/D1 platform limit/)
  })

  it('bulk action with 100 ids succeeds at its own advertised maximum (was: 500)', async () => {
    const h = db()
    seedBookmarks(h, 100)
    const call = mount(h, 'post', '/bulk', bulkBookmarksHandler)
    const ids = Array.from({ length: 100 }, (_, i) => `bm-${i}`)
    const res = await call({ action: 'delete', bookmark_ids: ids })
    expect(res.status).toBe(200)
    const body = JSON.parse(await res.text()) as { data: { affected_count: number } }
    expect(body.data.affected_count).toBe(100)
    expect(h.sqlite.prepare('SELECT COUNT(*) AS n FROM bookmarks WHERE deleted_at IS NOT NULL').get()).toEqual({ n: 100 })
  })

  it('emptyTrash with 150 trashed bookmarks records every tombstone (was: silent loss past 99)', async () => {
    const h = db()
    seedBookmarks(h, 150, { trashed: true })
    const result = await emptyTrash(h.db, USER)
    expect(result.success).toBe(true)
    // The tombstones are the delete sync_changes records for the trashed ids.
    const tombstones = h.sqlite
      .prepare(`SELECT COUNT(*) AS n FROM sync_changes WHERE entity_type = 'bookmark' AND operation = 'delete'`)
      .get() as { n: number }
    expect(tombstones.n).toBe(150)
    expect(h.sqlite.prepare('SELECT COUNT(*) AS n FROM bookmarks').get()).toEqual({ n: 0 })
  })

  it('reorder with 200 updates succeeds (was: 201 params → 500)', async () => {
    const h = db()
    seedBookmarks(h, 200)
    const call = mount(h, 'post', '/reorder', reorderBookmarksHandler)
    const res = await call({
      updates: Array.from({ length: 200 }, (_, i) => ({ id: `bm-${i}`, position: i })),
    })
    expect(res.status).toBe(200)
    const assigned = h.sqlite
      .prepare('SELECT COUNT(*) AS n FROM bookmarks WHERE position IS NOT NULL')
      .get() as { n: number }
    expect(assigned.n).toBe(200)
    const last = h.sqlite
      .prepare('SELECT position AS p FROM bookmarks WHERE id = ?')
      .get('bm-199') as { p: number }
    expect(last.p).toBe(199)
  })

  it('bookmark create with 100 tags succeeds (was: 101 params on the name resolution read)', async () => {
    const h = db()
    const call = mount(h, 'post', '/bookmarks', createBookmarkHandler)
    const tags = Array.from({ length: 100 }, (_, i) => `tag-${i}`)
    const res = await call({ title: 't', url: 'https://example.com/a', tags })
    expect(res.status).toBe(201)
    const links = h.sqlite.prepare('SELECT COUNT(*) AS n FROM bookmark_tags').get() as { n: number }
    expect(links.n).toBe(100)
  })

  it('search with a full 100-result page succeeds (was: 101 params on the tag read)', async () => {
    const h = db()
    seedBookmarks(h, 100, { keyword: 'needle' })
    const call = mount(h, 'get', '/search', searchHandler)
    const res = await call(undefined, '?q=needle&limit=100')
    expect(res.status).toBe(200)
    const body = JSON.parse(await res.text()) as { data: { results: { bookmarks: unknown[] } } }
    expect(body.data.results.bookmarks).toHaveLength(100)
  })

  it('rejects sync push tag arrays over the 99-item cap', () => {
    const payload = (tagNames: string[]) => ({
      title: 't',
      url: 'https://example.com/a',
      tag_names: tagNames,
    })
    expect(validateBookmarkPayload(payload(Array.from({ length: 99 }, (_, i) => `t${i}`)), 'upsert')).toBeNull()
    expect(validateBookmarkPayload(payload(Array.from({ length: 100 }, (_, i) => `t${i}`)), 'upsert'))
      .toContain('Too many tag names')
  })

  it('rejects sync push tab arrays over the 200-item cap', () => {
    const payload = (tabs: unknown[]) => ({ title: 'g', tabs })
    const tab = { url: 'https://example.com/x', title: 'x' }
    expect(validateTabGroupPayload(payload(Array.from({ length: 200 }, () => tab)), 'upsert')).toBeNull()
    expect(validateTabGroupPayload(payload(Array.from({ length: 201 }, () => tab)), 'upsert'))
      .toContain('Too many tabs')
  })
})
