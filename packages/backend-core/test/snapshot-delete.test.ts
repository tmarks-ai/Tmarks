import { Hono } from 'hono'
import { afterEach, describe, expect, it } from 'vitest'
import { generateJWT } from '@tmarks/backend-core'
import { snapshotRoutes } from '../src/routes/bookmarks/id/snapshots'
import { createSqliteD1, type SqliteD1Harness } from './helpers/sqlite-d1'
import type { AppEnv } from '../src/lib/env'

/**
 * R5-8 回归:deleteSnapshotHandler 曾先删 R2 后删行——R2 删除成功、D1 失败后,
 * 行会指向一个已删除的对象(读取时 404"内容不存在")。修复:行删 + outbox 入队
 * 在同一原子批次中先提交,R2 尽力删 + 成功后移除 job(与轮换路径同模式)。
 * 本文件覆盖:D1 失败时行已删且 outbox 留任务;正常路径三态全净。
 */
const USER = 'user-1'
const JWT_SECRET = 'x'.repeat(32)

let harness: SqliteD1Harness | null = null

function db(): SqliteD1Harness {
  harness = createSqliteD1(USER)
  return harness
}

afterEach(() => {
  harness?.close()
  harness = null
})

function r2() {
  const store = new Map<string, string>()
  const controls = { failDelete: false }
  return {
    store,
    controls,
    binding: {
      async put(key: string, value: string) { store.set(key, value) },
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

function mount(h: SqliteD1Harness, r2binding: R2Bucket, token: string) {
  const app = new Hono<AppEnv>()
  app.route('/bookmarks/:id/snapshots', snapshotRoutes)
  return (request: Request) => {
    const headers = new Headers(request.headers)
    headers.set('Authorization', `Bearer ${token}`)
    return app.request(new Request(request, { headers }), undefined, {
      DB: h.db,
      SNAPSHOTS: r2binding,
      JWT_SECRET,
    } as AppEnv['Bindings'])
  }
}

async function setup(h: SqliteD1Harness) {
  const token = await seedAuth(h)
  seedBookmark(h)
  const bucket = r2()
  const call = mount(h, bucket.binding, token)
  return { call, bucket }
}

async function createSnapshot(call: (request: Request) => Promise<Response>): Promise<string> {
  const res = await call(
    new Request('http://x/bookmarks/bm-1/snapshots', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ html_content: '<html>doomed</html>' }),
    }),
  )
  expect(res.status).toBe(201)
  return ((await res.json()) as { data: { snapshot: { id: string } } }).data.snapshot.id
}

describe('snapshot delete commit order (R5-8)', () => {
  it('commits the row delete first; a failed R2 cleanup is queued for the drain, not leaked into a dangling row', async () => {
    const h = db()
    const { call, bucket } = await setup(h)
    const snapshotId = await createSnapshot(call)

    bucket.controls.failDelete = true
    const res = await call(new Request(`http://x/bookmarks/bm-1/snapshots/${snapshotId}`, { method: 'DELETE' }))

    // The response succeeds (the commit point is the D1 batch)...
    expect(res.status).toBe(200)
    // ...the row is gone (pre-fix: the object was gone and the row survived,
    // pointing at deleted content)...
    expect(h.sqlite.prepare('SELECT COUNT(*) AS n FROM bookmark_snapshots').get()).toEqual({ n: 0 })
    // ...the object stays for the scheduled drain retry, recorded in the outbox.
    expect(bucket.store.size).toBe(1)
    expect(h.sqlite.prepare('SELECT COUNT(*) AS n FROM storage_cleanup_jobs').get()).toEqual({ n: 1 })
  })

  it('happy path: row gone, object gone, outbox job cleaned up', async () => {
    const h = db()
    const { call, bucket } = await setup(h)
    const snapshotId = await createSnapshot(call)

    const res = await call(new Request(`http://x/bookmarks/bm-1/snapshots/${snapshotId}`, { method: 'DELETE' }))

    expect(res.status).toBe(200)
    expect(h.sqlite.prepare('SELECT COUNT(*) AS n FROM bookmark_snapshots').get()).toEqual({ n: 0 })
    expect(bucket.store.size).toBe(0)
    expect(h.sqlite.prepare('SELECT COUNT(*) AS n FROM storage_cleanup_jobs').get()).toEqual({ n: 0 })
  })
})

