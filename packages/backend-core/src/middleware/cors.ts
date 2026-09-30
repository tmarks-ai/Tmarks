import type { MiddlewareHandler } from 'hono'
import type { AppEnv } from '../lib/env'
import { getEnvironment } from '../lib/config'

interface CorsPolicy {
  /** 'echo' mirrors the request origin with credentials, 'none' emits no CORS headers. */
  origin: 'echo' | 'none'
  echoedOrigin?: string
  allowCredentials: boolean
}

/**
 * CORS middleware. Cross-origin access is granted only to origins explicitly
 * listed in CORS_ALLOWED_ORIGINS (browser extensions must be listed there to
 * receive credentials) plus localhost in development. Unknown origins get no
 * Access-Control-Allow-Origin header at all — echoing `null` would let
 * sandboxed iframes read API responses. The Web app is same-origin to the
 * worker and needs no CORS.
 */
export const cors: MiddlewareHandler<AppEnv> = async (c, next) => {
  const policy = getCorsPolicy(c.req.raw, c.env)

  if (c.req.method === 'OPTIONS') {
    const headers = buildPreflightHeaders(policy)
    return new Response(null, { headers })
  }

  await next()
  const headers = new Headers(c.res.headers)
  if (policy.origin === 'echo') {
    headers.set('Access-Control-Allow-Origin', policy.echoedOrigin || '')
    if (policy.allowCredentials) {
      headers.set('Access-Control-Allow-Credentials', 'true')
    }
    headers.set('Vary', 'Origin')
  }
  c.res = new Response(c.res.body, { status: c.res.status, statusText: c.res.statusText, headers })
}

function buildPreflightHeaders(policy: CorsPolicy): Record<string, string> {
  if (policy.origin === 'none') {
    return {}
  }
  const headers: Record<string, string> = {
    'Access-Control-Allow-Origin': policy.echoedOrigin || '',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-API-Key',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  }
  if (policy.allowCredentials) {
    headers['Access-Control-Allow-Credentials'] = 'true'
  }
  return headers
}

function getCorsPolicy(request: Request, env: AppEnv['Bindings']): CorsPolicy {
  const origin = request.headers.get('Origin')
  if (!origin) {
    return { origin: 'none', allowCredentials: false }
  }

  const envOrigins = env.CORS_ALLOWED_ORIGINS
    ? env.CORS_ALLOWED_ORIGINS.split(',').map((o) => o.trim()).filter(Boolean)
    : []
  if (envOrigins.includes(origin)) {
    return { origin: 'echo', echoedOrigin: origin, allowCredentials: true }
  }

  if (getEnvironment(env) === 'development' && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
    return { origin: 'echo', echoedOrigin: origin, allowCredentials: true }
  }

  return { origin: 'none', allowCredentials: false }
}