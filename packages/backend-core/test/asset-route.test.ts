import { Hono } from 'hono'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { publicAssetRoutes } from '../src/routes/assets'
import { createSqliteD1, type SqliteD1Harness } from './helpers/sqlite-d1'
import { r2 } from './helpers/asset-test-utils'
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
  vi.unstubAllGlobals()
})

describe('public asset route', () => {
  function mount(h: SqliteD1Harness, binding: R2Bucket) {
    const app = new Hono<AppEnv>()
    app.route('/assets', publicAssetRoutes)
    return (path: string, init?: RequestInit) =>
      app.request(new Request(`http://localhost${path}`, init), undefined, {
        DB: h.db,
        SNAPSHOTS: binding,
      } as AppEnv['Bindings'])
  }

  it('serves a stored asset without auth, with cache headers and ETag 304', async () => {
    const h = db()
    const bucket = r2()
    const call = mount(h, bucket.binding)

    const hash = 'a'.repeat(64)
    await bucket.binding.put(`assets/favicon/${hash}`, new Uint8Array([1, 2, 3]), {
      httpMetadata: { contentType: 'image/png' },
    })

    const res = await call(`/assets/favicon/${hash}`)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('image/png')
    expect(res.headers.get('cache-control')).toContain('immutable')
    expect(res.headers.get('cache-control')).toContain('public, max-age=31536000')
    expect(res.headers.get('etag')).toBe(`"${hash}"`)
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]))

    const cached = await call(`/assets/favicon/${hash}`, { headers: { 'If-None-Match': `"${hash}"` } })
    expect(cached.status).toBe(304)
  })

  it('rejects malformed kind/hash without touching the bucket', async () => {
    const h = db()
    const bucket = r2()
    const call = mount(h, bucket.binding)

    expect((await call('/assets/evil/not-a-hash')).status).toBe(404)
    expect((await call('/assets/favicon/short')).status).toBe(404)
    expect(bucket.store.size).toBe(0)
  })
})
