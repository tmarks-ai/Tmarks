import { Hono } from 'hono'
import type { Context } from 'hono'
import type { AppEnv } from '../lib/env'
import { fetchPublicSharePage } from '../lib/share'
import { getClientIp } from '../lib/api-key/rate-limiter'
import { consumeUnauthenticatedRateLimit } from '../lib/api-key/rate-limit-binding'
import type { RateLimitConfig } from '../lib/api-key/rate-limiter-types'
import { internalError, notFound, success, tooManyRequests } from '../lib/response'

// Unauthenticated endpoint: the slug is the only secret, so both per-IP and
// global buckets cap enumeration. Deny on limiter failure — a broken limiter
// must not open the share space to unthrottled guessing.
const SHARE_IP_LIMITS: RateLimitConfig = { per_minute: 60, per_hour: 600, per_day: 3000 }
const SHARE_GLOBAL_LIMITS: RateLimitConfig = { per_minute: 600, per_hour: 6000, per_day: 30000 }

async function getPublicShareHandler(c: Context<AppEnv>): Promise<Response> {
  const slug = c.req.param('slug')?.trim().toLowerCase()
  if (!slug) return notFound('Public share not found')

  const clientIP = getClientIp(c.req.raw)
  for (const [key, limits] of [
    [`share:${clientIP}`, SHARE_IP_LIMITS],
    ['share:global', SHARE_GLOBAL_LIMITS],
  ] as const) {
    const rate = await consumeUnauthenticatedRateLimit(c.env, key, limits)
    if (!rate.allowed) {
      return tooManyRequests(
        { code: 'RATE_LIMITED', message: 'Too many requests' },
        { 'Retry-After': String(rate.retryAfter || 60) }
      )
    }
  }

  // Public-share responses contain user-controlled privacy state. Do not use
  // the shared edge cache here: disabling or privatizing a bookmark must take
  // effect on the next request, not after a cache TTL.
  try {
    const page = await fetchPublicSharePage(c.env.DB, slug)
    if (!page) return notFound('Public share not found')
    const response = success({ page })
    const headers = new Headers(response.headers)
    headers.set('Cache-Control', 'no-store')
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers })
  } catch (error) {
    console.error('Failed to load public share:', error)
    return internalError('Failed to load public share')
  }
}

export const publicShareRoutes = new Hono<AppEnv>()
publicShareRoutes.get('/share/:slug', getPublicShareHandler)