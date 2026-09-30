import { Hono } from 'hono'
import { afterEach, describe, expect, it } from 'vitest'
import { generateJWT } from '@tmarks/backend-core'
import { snapshotRoutes } from '../src/routes/bookmarks/id/snapshots'
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

/** Minimal R2 memory mock: only the surface the route uses. */
function r2() {
  const store = new Map<string, string>()
  const controls = { failPut: false, failDelete: false }
  return {
    store,
    controls,
    binding: {
      async put(key: string, value: string) {
        if (controls.failPut) throw new Error('R2 put failed')
        store.set(key, value)
      },
      async get(key: string) {
        const value = store.get(key)
        return value === undefined ? null : { body: value, httpEtag: `"${key}"` }
      },
      async delete(key: string) {
        if (controls.failDelete) throw new Error('R2 delete failed')
        store.delete(key)
      },
    } as unknown as R2Bucket,
  }
}

function mount(h: SqliteD1Harness, r2binding: R2Bucket, token: string, dbBinding: D1Database = h.db) {
  const app = new Hono<AppEnv>()
  app.route('/bookmarks/:id/snapshots', snapshotRoutes)
  return (request: Request) => {
    const headers = new Headers(request.headers)
    headers.set('Authorization', `Bearer ${token}`)
    return app.request(new Request(request, { headers }), undefined, {
      DB: dbBinding,
      SNAPSHOTS: r2binding,
      JWT_SECRET,
    } as AppEnv['Bindings'])
  }
}

const JWT_SECRET = 'x'.repeat(32)

async function seedAuth(h: SqliteD1Harness): Promise<string> {
  h.sqlite
    .prepare(
      `INSERT INTO auth_tokens (user_id, refresh_token_hash, session_id, expires_at, created_at)
       VALUES (?, 'h', 'sess-1', ?, ?)`
    )
    .run(USER, new Date(Date.now() + 3600_000).toISOString(), new Date().toISOString())
  return generateJWT({ sub: USER, session_id: 'sess-1' }, JWT_SECRET, '1h')
}

function seedBookmark(h: SqliteD1Harness) {
  h.sqlite
    .prepare(`INSERT INTO bookmarks (id, user_id, title, url, created_at, updated_at) VALUES ('bm-1', ?, 't', 'https://example.com/a', ?, ?)`)
    .run(USER, new Date().toISOString(), new Date().toISOString())
}

function countVersions(h: SqliteD1Harness): number {
  return (h.sqlite.prepare('SELECT COUNT(*) AS n FROM bookmark_snapshots').get() as { n: number }).n
}

type SnapshotCall = (request: Request) => Promise<Response>

async function saveSnapshot(call: SnapshotCall, html: string): Promise<Response> {
  return call(
    new Request('http://x/bookmarks/bm-1/snapshots', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ html_content: html, title: html }),
    }),
  )
}

async function fillVersionLimit(call: SnapshotCall): Promise<void> {
  for (let i = 0; i < 20; i += 1) {
    const res = await saveSnapshot(call, `<html>v${i}</html>`)
    expect(res.status, `seed upload ${i}`).toBe(201)
  }
}

function failSnapshotInserts(database: D1Database): D1Database {
  return {
    prepare(sql: string) {
      if (sql.includes('INSERT INTO bookmark_snapshots')) {
        return {
          bind: () => ({
            first: async () => {
              throw new Error('D1 insert failed')
            },
          }),
        }
      }
      return database.prepare(sql)
    },
  } as unknown as D1Database
}

describe('snapshot version rotation (regression: 21st save used to 400 forever)', () => {
  it('rotates the oldest version (row + R2 object) instead of rejecting', async () => {
    const h = db()
    const bucket = r2()
    const token = await seedAuth(h)
    const call = mount(h, bucket.binding, token)
    seedBookmark(h)

    for (let i = 0; i < 21; i += 1) {
      const res = await call(
        new Request(`http://x/bookmarks/bm-1/snapshots`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ html_content: `<html>v${i}</html>`, title: `v${i}` }),
        })
      )
      expect(res.status, `upload ${i}`).toBeLessThan(400)
    }

    // Still capped at 20, the oldest version is gone, v21 is the latest.
    expect(countVersions(h)).toBe(20)
    const oldest = h.sqlite
      .prepare('SELECT MIN(version) AS v FROM bookmark_snapshots')
      .get() as { v: number }
    expect(oldest.v).toBe(2)
    const latest = h.sqlite
      .prepare('SELECT MAX(version) AS v, snapshot_title AS t FROM bookmark_snapshots')
      .get() as { v: number; t: string }
    expect(latest).toEqual({ v: 21, t: 'v20' })
    // The rotated row's R2 object is gone too — no orphan.
    expect(bucket.store.size).toBe(20)
  })

  it('keeps all old rows and objects when the replacement R2 put fails', async () => {
    const h = db()
    const bucket = r2()
    const token = await seedAuth(h)
    const call = mount(h, bucket.binding, token)
    seedBookmark(h)
    await fillVersionLimit(call)
    const oldKeys = new Set(bucket.store.keys())

    bucket.controls.failPut = true
    const res = await saveSnapshot(call, '<html>new</html>')

    expect(res.status).toBe(500)
    expect(countVersions(h)).toBe(20)
    expect(new Set(bucket.store.keys())).toEqual(oldKeys)
  })

  it('keeps all old rows and objects when the replacement D1 insert fails', async () => {
    const h = db()
    const bucket = r2()
    const token = await seedAuth(h)
    seedBookmark(h)
    await fillVersionLimit(mount(h, bucket.binding, token))
    const oldKeys = new Set(bucket.store.keys())
    const call = mount(h, bucket.binding, token, failSnapshotInserts(h.db))

    const res = await saveSnapshot(call, '<html>new</html>')

    expect(res.status).toBe(500)
    expect(countVersions(h)).toBe(20)
    expect(new Set(bucket.store.keys())).toEqual(oldKeys)
  })

  it('returns the new version when deleting the rotated R2 object fails', async () => {
    const h = db()
    const bucket = r2()
    const token = await seedAuth(h)
    const call = mount(h, bucket.binding, token)
    seedBookmark(h)
    await fillVersionLimit(call)
    bucket.controls.failDelete = true

    const res = await saveSnapshot(call, '<html>new</html>')

    expect(res.status).toBe(201)
    expect(countVersions(h)).toBe(20)
    const latest = h.sqlite
      .prepare('SELECT MAX(version) AS v, snapshot_title AS t FROM bookmark_snapshots')
      .get() as { v: number; t: string }
    expect(latest).toEqual({ v: 21, t: '<html>new</html>' })
    expect(bucket.store.size).toBe(21)
    expect([...bucket.store.values()]).toContain('<html>new</html>')
  })
})

describe('snapshot content dedupe (regression: identical re-saves burned versions)', () => {
  it('an unchanged page returns the existing latest snapshot without a new version', async () => {
    const h = db()
    const bucket = r2()
    const token = await seedAuth(h)
    const call = mount(h, bucket.binding, token)
    seedBookmark(h)

    const body = JSON.stringify({ html_content: '<html>same</html>', title: 'same' })
    const first = await call(new Request('http://x/bookmarks/bm-1/snapshots', { method: 'POST', headers: { 'content-type': 'application/json' }, body }))
    const again = await call(new Request('http://x/bookmarks/bm-1/snapshots', { method: 'POST', headers: { 'content-type': 'application/json' }, body }))

    expect(first.status).toBe(201)
    expect(again.status).toBeLessThan(400)
    const firstData = (await first.json()) as { data: { snapshot: { id: string } } }
    const againData = (await again.json()) as { data: { snapshot: { id: string } } }
    expect(againData.data.snapshot.id).toBe(firstData.data.snapshot.id)
    expect(countVersions(h)).toBe(1)
    expect(bucket.store.size).toBe(1)
  })
})

describe('snapshot GET conditional requests', () => {
  it('answers 304 for a matching If-None-Match instead of re-transferring the body', async () => {
    const h = db()
    const bucket = r2()
    const token = await seedAuth(h)
    const call = mount(h, bucket.binding, token)
    seedBookmark(h)

    const created = await call(
      new Request('http://x/bookmarks/bm-1/snapshots', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ html_content: '<html>body</html>' }),
      })
    )
    const snapshot = ((await created.json()) as { data: { snapshot: { id: string; content_hash: string } } }).data.snapshot

    const first = await call(new Request(`http://x/bookmarks/bm-1/snapshots/${snapshot.id}`))
    expect(first.status).toBe(200)
    const etag = first.headers.get('ETag')
    expect(etag).toBeTruthy()

    const revalidated = await call(
      new Request(`http://x/bookmarks/bm-1/snapshots/${snapshot.id}`, { headers: { 'If-None-Match': etag! } })
    )
    expect(revalidated.status).toBe(304)
    await expect(revalidated.text()).resolves.toBe('')
  })
})
