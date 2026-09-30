import { Hono } from 'hono'
import { describe, expect, it } from 'vitest'
import { generateJWT, requireDataAuth } from '@tmarks/backend-core'
import { apiKeysRoutes } from '../src/routes/settings/api-keys'
import type { AppEnv } from '../src/lib/env'

const JWT_SECRET = 'auth-boundary-test-secret'

const FUTURE = new Date(Date.now() + 3600_000).toISOString()

// Mock D1: the auth_tokens session lookup resolves to a non-expired row,
// every other query (e.g. api_keys) returns null.
const db = {
  prepare: (sql: string) => ({
    bind: () => ({
      first: async () => (sql.includes('FROM auth_tokens') ? { expires_at: FUTURE } : null),
    }),
  }),
} as unknown as D1Database

const env = { JWT_SECRET, DB: db } as AppEnv['Bindings']

describe('Web and Tab authentication boundaries', () => {
  it('accepts the Web login token on shared data routes without an API key', async () => {
    const app = new Hono<AppEnv>()
    app.get('/data', requireDataAuth('bookmarks.read'), (c) => c.json({ auth: c.get('auth') }))
    // Access tokens are session-bound: a token without session_id is rejected
    // by verifyJWT, so mint one with a session that the mock DB reports active.
    const token = await generateJWT({ sub: 'owner', session_id: 'test-session' }, JWT_SECRET)

    const response = await app.request('/data', {
      headers: { Authorization: `Bearer ${token}` },
    }, env)

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({ auth: { user_id: 'owner', auth_type: 'jwt' } })
  })

  it('rejects a Web token whose session is not active on the server', async () => {
    const app = new Hono<AppEnv>()
    app.get('/data', requireDataAuth('bookmarks.read'), (c) => c.json({ auth: c.get('auth') }))
    const token = await generateJWT({ sub: 'owner', session_id: 'test-session' }, JWT_SECRET)
    // A server-side session lookup that finds no active row must fail closed.
    const revokedEnv = {
      JWT_SECRET,
      DB: {
        prepare: (sql: string) => ({
          bind: () => ({ first: async () => (sql.includes('FROM auth_tokens') ? null : null) }),
        }),
      } as unknown as D1Database,
    } as AppEnv['Bindings']

    const response = await app.request('/data', {
      headers: { Authorization: `Bearer ${token}` },
    }, revokedEnv)

    expect(response.status).toBe(401)
  })

  it('does not allow a Tab API key to manage API keys in the Web control plane', async () => {
    const app = new Hono<AppEnv>()
    app.route('/settings/api-keys', apiKeysRoutes)

    const response = await app.request('/settings/api-keys', {
      headers: { 'X-API-Key': 'tmk_extension_key' },
    }, env)

    expect(response.status).toBe(401)
  })
})