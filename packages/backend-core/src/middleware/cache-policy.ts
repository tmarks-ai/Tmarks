import type { MiddlewareHandler } from 'hono'
import type { AppEnv } from '../lib/env'

const PRIVATE_API_CACHE_CONTROL = 'no-store'

/** Force `Cache-Control: no-store` on API responses. */
export const cachePolicy: MiddlewareHandler<AppEnv> = async (c, next) => {
  await next()

  // Public routes own their cache headers: the share page deliberately
  // serves `no-store` (privacy changes must take effect on the next request,
  // not after a TTL) and the asset route sets its own immutable long-life
  // policy; this middleware must not overwrite either.
  if (c.req.path.startsWith('/api/public/')) return

  const headers = new Headers(c.res.headers)

  headers.set('Cache-Control', PRIVATE_API_CACHE_CONTROL)
  headers.set('Pragma', 'no-cache')
  headers.set('Expires', '0')
  c.res = new Response(c.res.body, { status: c.res.status, statusText: c.res.statusText, headers })
}
