import { Hono } from 'hono'
import { describe, expect, it } from 'vitest'
import { securityHeaders } from '../src/middleware/security-headers'
import type { AppEnv } from '../src/lib/env'

/**
 * 安全响应头中间件回归网(R5 审计确认此前零单测,仅靠线上冒烟验证):
 * 头齐全、HTTPS 下 HSTS 三件套、快照路由自带更严 CSP 时不被覆盖、
 * HTTP(本地开发)不发 HSTS。
 */
function mount(urlPrefix = 'https://tmarks.example') {
  const app = new Hono<AppEnv>()
  app.use('*', securityHeaders)
  app.get('/plain', (c) => c.text('ok'))
  app.get('/snapshot-like', (c) => {
    c.header('Content-Security-Policy', "default-src 'none'")
    return c.text('html')
  })
  return (path: string) =>
    app.request(new Request(`${urlPrefix}${path}`))
}

describe('securityHeaders middleware', () => {
  it('applies the full standard header set to every response', async () => {
    const res = await mount()('/plain')
    expect(res.headers.get('X-Frame-Options')).toBe('DENY')
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff')
    expect(res.headers.get('X-XSS-Protection')).toBe('1; mode=block')
    expect(res.headers.get('Referrer-Policy')).toBe('strict-origin-when-cross-origin')
    expect(res.headers.get('Permissions-Policy')).toBe('camera=(), microphone=(), geolocation=(), payment=()')
    const csp = res.headers.get('Content-Security-Policy')!
    expect(csp).toContain("default-src 'self'")
    expect(csp).toContain("script-src 'self'")
    expect(csp).toContain("frame-ancestors 'none'")
    expect(csp).toContain("object-src 'none'")
    expect(csp).toContain("base-uri 'self'")
    expect(csp).toContain("form-action 'self'")
  })

  it('adds HSTS with includeSubDomains and preload on HTTPS requests only', async () => {
    const https = await mount()('/plain')
    expect(https.headers.get('Strict-Transport-Security'))
      .toBe('max-age=31536000; includeSubDomains; preload')

    const http = await mount('http://localhost:8787')('/plain')
    expect(http.headers.get('Strict-Transport-Security')).toBeNull()
  })

  it('never overwrites a stricter CSP already set by a content-serving route', async () => {
    const res = await mount()('/snapshot-like')
    expect(res.headers.get('Content-Security-Policy')).toBe("default-src 'none'")
  })

  it('preserves the body and status of the inner response', async () => {
    const res = await mount()('/plain')
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('ok')
  })
})
