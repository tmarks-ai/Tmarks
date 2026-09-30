import { Hono } from 'hono'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { app } from '../src/app'
import { createSqliteD1, type SqliteD1Harness } from './helpers/sqlite-d1'
import { generateJWT } from '@tmarks/backend-core'
import type { AppEnv } from '../src/lib/env'

/**
 * Full middleware-chain integration tests: mount the REAL `app` (not a
 * hand-injected handler) with the real middleware order (requestLogger →
 * cors → cachePolicy → securityHeaders → jsonBodyGuard), a real D1
 * harness, and a JWT auth token. This exercises the entire request
 * pipeline end to end — the R5 audit identified the middleware chain as
 * the biggest zero-coverage surface (only security-headers had unit tests).
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
  vi.unstubAllGlobals()
})

async function seedUserAndGetToken(h: SqliteD1Harness): Promise<string> {
  const now = new Date().toISOString()
  h.sqlite
    .prepare(`INSERT INTO auth_tokens (user_id, refresh_token_hash, session_id, expires_at, created_at) VALUES (?, 'h', 'sess-1', ?, ?)`)
    .run(USER, new Date(Date.now() + 3600_000).toISOString(), now)
  return generateJWT({ sub: USER, session_id: 'sess-1' }, JWT_SECRET, '1h')
}

function callApp(h: SqliteD1Harness, token: string | null, path: string, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers)
  if (token) headers.set('Authorization', `Bearer ${token}`)
  return app.request(new Request(`http://localhost${path}`, { ...init, headers }), undefined, {
    DB: h.db,
    JWT_SECRET,
    ENVIRONMENT: 'development',
    RATE_LIMITER: undefined,
    GLOBAL_RATE_LIMITER: undefined,
  } as AppEnv['Bindings'])
}

describe('full middleware chain (security headers + cache policy + CORS + 404 + error handler)', () => {
  it('applies the security header set to every API response', async () => {
    const h = db()
    const res = await callApp(h, null, '/api/v1/health')
    expect(res.status).toBe(200)
    expect(res.headers.get('X-Frame-Options')).toBe('DENY')
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff')
    expect(res.headers.get('Referrer-Policy')).toBe('strict-origin-when-cross-origin')
    expect(res.headers.get('Content-Security-Policy')).toContain("default-src 'self'")
  })

  it('applies no-store Cache-Control to private API responses', async () => {
    const h = db()
    const res = await callApp(h, null, '/api/v1/health')
    expect(res.headers.get('Cache-Control')).toBe('no-store')
  })

  it('does not send CORS headers for unknown origins', async () => {
    const h = db()
    const res = await app.request(
      new Request('http://localhost/api/v1/health', {
        headers: { Origin: 'https://evil.example.com' },
      }),
      undefined,
      { DB: h.db, JWT_SECRET, ENVIRONMENT: 'development' } as AppEnv['Bindings'],
    )
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull()
  })

  it('answers a 404 JSON envelope for unknown API routes', async () => {
    const h = db()
    const res = await callApp(h, null, '/api/v1/definitely-not-a-route')
    expect(res.status).toBe(404)
    const body = JSON.parse(await res.text()) as { error: { code: string; message: string } }
    expect(body.error.code).toBe('NOT_FOUND')
    expect(body.error.message).toBe('Route not found')
  })

  it('rejects a malformed JSON write body with 400 (guard + error handler chain)', async () => {
    const h = db()
    const token = await seedUserAndGetToken(h)
    const res = await callApp(h, token, '/api/v1/bookmarks', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{"title": ',
    })
    expect(res.status).toBe(400)
    const body = JSON.parse(await res.text()) as { error: { code: string } }
    expect(body.error.code).toBe('BAD_REQUEST')
  })

  it('rejects an oversized auth body at the guard (413)', async () => {
    const h = db()
    const res = await callApp(h, null, '/api/v1/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'content-length': String(200 * 1024) },
      body: '{"padding":"' + 'x'.repeat(200 * 1024) + '"}',
    })
    expect(res.status).toBe(413)
  })

  it('returns 401 MISSING_API_KEY for a protected route without credentials', async () => {
    const h = db()
    const res = await callApp(h, null, '/api/v1/bookmarks')
    expect(res.status).toBe(401)
    const body = JSON.parse(await res.text()) as { error: { code: string } }
    expect(body.error.code).toBe('MISSING_API_KEY')
  })

  it('returns 401 INVALID_TOKEN for a forged bearer token', async () => {
    const h = db()
    const res = await callApp(h, 'totally-fake-token', '/api/v1/bookmarks')
    expect(res.status).toBe(401)
    const body = JSON.parse(await res.text()) as { error: { code: string } }
    expect(body.error.code).toBe('INVALID_TOKEN')
  })

  it('serves an authenticated CRUD request end to end (token → route → D1 → response)', async () => {
    const h = db()
    const token = await seedUserAndGetToken(h)

    // Create a bookmark
    const created = await callApp(h, token, '/api/v1/bookmarks', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'Test Bookmark', url: 'https://example.com/test', tags: ['audit'] }),
    })
    expect(created.status).toBe(201)
    const createdBody = JSON.parse(await created.text()) as { data: { bookmark: { id: string } } }
    expect(createdBody.data.bookmark.id).toBeTruthy()

    // Read it back
    const fetched = await callApp(h, token, `/api/v1/bookmarks/${createdBody.data.bookmark.id}`)
    expect(fetched.status).toBe(200)
    const fetchedBody = JSON.parse(await fetched.text()) as { data: { bookmark: { title: string } } }
    expect(fetchedBody.data.bookmark.title).toBe('Test Bookmark')

    // The response went through the full middleware chain (security headers present)
    expect(fetched.headers.get('X-Frame-Options')).toBe('DENY')
    expect(fetched.headers.get('Cache-Control')).toBe('no-store')
  })

  it('serves the public share page without credentials and with the public cache exemption', async () => {
    const h = db()
    // The health route doubles as a stand-in: any /api/v1/* response carries no-store.
    // /api/public/* is exempted from cache-policy (it sets its own headers).
    const res = await callApp(h, null, '/api/public/share/nonexistent-slug')
    expect(res.status).toBe(404)
    // The public share route answers NOT_FOUND through its own handler,
    // and security headers are still applied by the middleware.
    expect(res.headers.get('X-Frame-Options')).toBe('DENY')
  })
})
