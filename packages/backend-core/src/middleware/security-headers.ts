import type { MiddlewareHandler } from 'hono'
import type { AppEnv } from '../lib/env'

const STANDARD_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: https:",
  "font-src 'self' data:",
  "connect-src 'self' https:",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ')

/** Apply security headers to every response. */
export const securityHeaders: MiddlewareHandler<AppEnv> = async (c, next) => {
  await next()

  const headers = new Headers(c.res.headers)
  headers.set('X-Frame-Options', 'DENY')
  headers.set('X-Content-Type-Options', 'nosniff')
  headers.set('X-XSS-Protection', '1; mode=block')
  headers.set('Referrer-Policy', 'strict-origin-when-cross-origin')
  headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()')
  // Routes that serve untrusted content set their own, stricter policy (see the
  // snapshot handler's `default-src 'none'`). Overwriting it here silently
  // relaxed those responses back to `script-src 'self'`.
  if (!headers.has('Content-Security-Policy')) {
    headers.set('Content-Security-Policy', STANDARD_CSP)
  }
  if (c.req.url.startsWith('https://')) {
    headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload')
  }

  c.res = new Response(c.res.body, { status: c.res.status, statusText: c.res.statusText, headers })
}
