import { describe, expect, it } from 'vitest'
import { Hono } from 'hono'
import type { AppEnv } from '../src/lib/env'
import { cors } from '../src/middleware/cors'

/**
 * CORS 中间件回归网(此前零覆盖):allowlist 回显带凭证、未知来源不发
 * Allow-Origin(绝不回显 null)、dev localhost 放行、生产 localhost 拒绝、
 * 预检头完整。回显错一个来源,凭证型 CORS 就等于把账号会话开放给任意站点。
 */

function mountCors(env: Partial<AppEnv['Bindings']>) {
  const app = new Hono<AppEnv>()
  app.use('*', cors)
  app.get('/ping', (c) => c.json({ ok: true }))
  return (origin: string | null, method = 'GET') =>
    app.request('/ping', {
      method,
      headers: origin ? { Origin: origin } : undefined,
    }, env as AppEnv['Bindings'])
}

const PROD = { ENVIRONMENT: 'production', CORS_ALLOWED_ORIGINS: 'https://app.example.com,https://ext.example' }

describe('cors middleware', () => {
  it('echoes an allowlisted origin with credentials and Vary: Origin', async () => {
    const call = mountCors(PROD)
    const res = await call('https://app.example.com')
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://app.example.com')
    expect(res.headers.get('Access-Control-Allow-Credentials')).toBe('true')
    expect(res.headers.get('Vary')).toContain('Origin')
  })

  it('emits no Allow-Origin for an unknown origin', async () => {
    const call = mountCors(PROD)
    const res = await call('https://evil.example')
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull()
    expect(res.headers.get('Access-Control-Allow-Credentials')).toBeNull()
  })

  it('never echoes the null origin (sandboxed iframes must not read responses)', async () => {
    const call = mountCors({ ...PROD, CORS_ALLOWED_ORIGINS: '' })
    const res = await call('null')
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull()
  })

  it('emits no CORS headers when the request carries no Origin', async () => {
    const call = mountCors(PROD)
    const res = await call(null)
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull()
  })

  it('allows localhost origins in development builds only', async () => {
    const dev = await mountCors({ ENVIRONMENT: 'development', CORS_ALLOWED_ORIGINS: '' })('http://localhost:5173')
    expect(dev.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:5173')

    const prod = await mountCors(PROD)('http://localhost:5173')
    expect(prod.headers.get('Access-Control-Allow-Origin')).toBeNull()
  })

  it('answers preflights with the full header set and terminates the chain', async () => {
    const app = new Hono<AppEnv>()
    let handlerReached = false
    app.use('*', cors)
    app.options('/ping', (c) => {
      handlerReached = true
      return c.json({ ok: true })
    })
    const res = await app.request('/ping', {
      method: 'OPTIONS',
      headers: { Origin: 'https://app.example.com' },
    }, PROD as AppEnv['Bindings'])

    expect(handlerReached).toBe(false) // preflight short-circuits in the middleware
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://app.example.com')
    expect(res.headers.get('Access-Control-Allow-Methods')).toBe('GET, POST, PUT, PATCH, DELETE, OPTIONS')
    expect(res.headers.get('Access-Control-Allow-Headers')).toContain('X-API-Key')
    expect(res.headers.get('Access-Control-Max-Age')).toBe('86400')
    expect(res.headers.get('Access-Control-Allow-Credentials')).toBe('true')
  })

  it('preflight from an unknown origin is also headerless', async () => {
    const call = mountCors(PROD)
    const res = await call('https://evil.example', 'OPTIONS')
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull()
    expect(res.headers.get('Access-Control-Allow-Methods')).toBeNull()
  })
})
