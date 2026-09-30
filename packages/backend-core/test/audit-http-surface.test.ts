import { Hono } from 'hono'
import { afterEach, describe, expect, it } from 'vitest'
import { jsonBodyGuard } from '../src/middleware/json-body-guard'
import { createBookmarkHandler } from '../src/routes/bookmarks/create'
import { reorderPinnedHandler } from '../src/routes/bookmarks/reorder-pinned'
import { listTabGroupsHandler } from '../src/routes/tab-groups/list'
import { createSqliteD1, type SqliteD1Harness } from './helpers/sqlite-d1'
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

function mount(h: SqliteD1Harness, path: string, handler: (c: never) => Promise<Response>) {
  const app = new Hono<AppEnv>()
  app.post(
    path,
    async (c, next) => {
      c.set('auth', { user_id: USER, auth_type: 'jwt' })
      await next()
    },
    handler as never
  )
  return (body: unknown) =>
    app.request(path, { method: 'POST', body: JSON.stringify(body) }, { DB: h.db } as AppEnv['Bindings'])
}

describe('bookmark create atomicity with tags', () => {
  it('persists the bookmark row and tag links together (single batch)', async () => {
    const h = db()
    const call = mount(h, '/bookmarks', createBookmarkHandler)

    const res = await call({ title: 't', url: 'https://example.com/a', tags: ['ai', 'tools'] })
    expect(res.status).toBe(201)

    const bookmark = h.sqlite.prepare('SELECT id FROM bookmarks WHERE url = ?').get('https://example.com/a') as
      | { id: string }
      | undefined
    expect(bookmark).toBeTruthy()
    const links = h.sqlite
      .prepare(
        `SELECT COUNT(*) AS n FROM bookmark_tags bt
         JOIN tags t ON t.id = bt.tag_id
         WHERE bt.bookmark_id = ? AND t.name IN ('ai', 'tools')`
      )
      .get(bookmark!.id) as { n: number }
    expect(links.n).toBe(2)
  })

  it('caps tag names at 50 chars on the bookmark plane (mirrors POST /tags)', async () => {
    const h = db()
    const call = mount(h, '/bookmarks', createBookmarkHandler)

    const res = await call({ title: 't', url: 'https://example.com/a', tags: ['x'.repeat(80)] })
    expect(res.status).toBe(201)
    const tag = h.sqlite.prepare('SELECT name FROM tags').get() as { name: string }
    expect(tag.name).toBe('x'.repeat(50))
  })
})

describe('reorder-pinned cap', () => {
  it('rejects more than 200 bookmark ids', async () => {
    const h = db()
    const call = mount(h, '/reorder-pinned', reorderPinnedHandler)

    const res = await call({ bookmark_ids: Array.from({ length: 201 }, (_, i) => `bm-${i}`) })

    expect(res.status).toBe(400)
  })
})

describe('tab-groups cursor tiebreaker', () => {
  function seedGroup(h: SqliteD1Harness, id: string, createdAt: string) {
    h.sqlite
      .prepare(`INSERT INTO tab_groups (id, user_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`)
      .run(id, USER, `g-${id}`, createdAt, createdAt)
  }

  function listPage(h: SqliteD1Harness, size: number, cursor?: string) {
    const app = new Hono<AppEnv>()
    app.get(
      '/tab-groups',
      async (c, next) => {
        c.set('auth', { user_id: USER, auth_type: 'jwt' })
        await next()
      },
      listTabGroupsHandler as never
    )
    const qs = `page_size=${size}${cursor ? `&page_cursor=${encodeURIComponent(cursor)}` : ''}`
    return app.request(`/tab-groups?${qs}`, {}, { DB: h.db } as AppEnv['Bindings'])
  }

  it('does not skip same-millisecond groups at a page boundary', async () => {
    const h = db()
    const sameMs = '2026-08-23T00:00:00.000Z'
    // Five groups sharing one created_at (bulk import shape); ids ordered
    // opposite to insertion so the id tiebreaker is load-bearing.
    for (const id of ['g-e', 'g-d', 'g-c', 'g-b', 'g-a']) seedGroup(h, id, sameMs)

    const page1 = await listPage(h, 3)
    expect(page1.status).toBe(200)
    const body1 = (await page1.json()) as { data: { tab_groups: Array<{ id: string }>; meta: { next_cursor: string; has_more: boolean } } }
    expect(body1.data.tab_groups.map((g) => g.id)).toEqual(['g-e', 'g-d', 'g-c'])
    expect(body1.data.meta.next_cursor).toBe(`${sameMs}|g-c`)

    const page2 = await listPage(h, 3, body1.data.meta.next_cursor)
    const body2 = (await page2.json()) as { data: { tab_groups: Array<{ id: string }>; meta: { has_more: boolean } } }
    // Before the fix the timestamp-only cursor skipped all remaining ties.
    expect(body2.data.tab_groups.map((g) => g.id)).toEqual(['g-b', 'g-a'])
    expect(body2.data.meta.has_more).toBe(false)
  })
})

describe('jsonBodyGuard', () => {
  it('answers 400 for malformed JSON on authenticated write requests', async () => {
    const app = new Hono<AppEnv>()
    app.use('*', jsonBodyGuard)
    app.post('/echo', (c) => c.json({ ok: true }))

    const res = await app.request('/echo', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'authorization': 'Bearer token' },
      body: '{"broken": ',
    })
    expect(res.status).toBe(400)
  })

  it('answers 400 for malformed JSON on the anonymous auth plane', async () => {
    const app = new Hono<AppEnv>()
    app.use('*', jsonBodyGuard)
    app.post('/api/v1/auth/login', (c) => c.json({ ok: true }))

    const res = await app.request('/api/v1/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{"broken": ',
    })
    expect(res.status).toBe(400)
  })

  it('rejects oversized authenticated bodies before the handler runs', async () => {
    const app = new Hono<AppEnv>()
    let handlerCalled = false
    app.use('*', jsonBodyGuard)
    app.post('/echo', (c) => {
      handlerCalled = true
      return c.json({ ok: true })
    })

    const res = await app.request('/echo', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'content-length': String(2 * 1024 * 1024),
        'authorization': 'Bearer token',
      },
      body: '{"padding":"' + 'x'.repeat(2 * 1024 * 1024) + '"}',
    })
    expect(res.status).toBe(413)
    expect(handlerCalled).toBe(false)
  })

  it('rejects oversized anonymous bodies on the auth plane (64KB cap)', async () => {
    const app = new Hono<AppEnv>()
    let handlerCalled = false
    app.use('*', jsonBodyGuard)
    app.post('/api/v1/auth/login', (c) => {
      handlerCalled = true
      return c.json({ ok: true })
    })

    const res = await app.request('/api/v1/auth/login', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'content-length': String(200 * 1024),
      },
      body: '{"padding":"' + 'x'.repeat(200 * 1024) + '"}',
    })
    expect(res.status).toBe(413)
    expect(handlerCalled).toBe(false)
  })

  it('skips the body read entirely for unauthenticated writes outside the auth plane (R5-4)', async () => {
    const app = new Hono<AppEnv>()
    app.use('*', jsonBodyGuard)
    app.post('/api/v1/bookmarks', (c) => c.json({ ok: true }))

    // No credentials: the request can only ever be 401'd by the auth
    // middleware, so the guard must not read it — not even the cheap
    // content-length precheck may reject it. Pre-fix this answered 413.
    const res = await app.request('/api/v1/bookmarks', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'content-length': String(20 * 1024 * 1024),
      },
      body: '{"padding":"' + 'x'.repeat(1024) + '"}',
    })
    expect(res.status).toBe(200)
  })

  it('still guards unauthenticated writes when an X-API-Key header is present', async () => {
    const app = new Hono<AppEnv>()
    app.use('*', jsonBodyGuard)
    app.post('/api/v1/sync/push', (c) => c.json({ ok: true }))

    const res = await app.request('/api/v1/sync/push', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': 'tmk_live_x' },
      body: '{"broken": ',
    })
    expect(res.status).toBe(400)
  })

  it('passes valid JSON through and keeps the body readable for the handler', async () => {
    const app = new Hono<AppEnv>()
    app.use('*', jsonBodyGuard)
    app.post('/echo', async (c) => c.json({ echoed: await c.req.json<{ x: number }>() }))

    const res = await app.request('/echo', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'authorization': 'Bearer token' },
      body: '{"x": 7}',
    })
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ echoed: { x: 7 } })
  })

  it('lets empty bodies through (auth endpoints tolerate them)', async () => {
    const app = new Hono<AppEnv>()
    app.use('*', jsonBodyGuard)
    app.post('/api/v1/auth/refresh', (c) => c.json({ ok: true }))

    const res = await app.request('/api/v1/auth/refresh', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '',
    })
    expect(res.status).toBe(200)
  })
})
