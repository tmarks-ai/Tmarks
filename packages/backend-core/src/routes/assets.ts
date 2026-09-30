import { Hono } from 'hono'
import type { Context } from 'hono'
import type { AppEnv } from '../lib/env'
import { internalError, notFound, tooManyRequests } from '../lib/response'
import { getClientIp } from '../lib/api-key/rate-limiter'
import { consumeAssetRateLimit } from '../lib/api-key/rate-limit-binding'
import type { RateLimitConfig } from '../lib/api-key/rate-limiter-types'

/**
 * Content-addressed image assets (bookmark favicons and cover images stored
 * in R2 by lib/bookmarks/asset-persist.ts), mounted at /api/public/assets.
 *
 * Unauthenticated by design: an <img> tag cannot carry a Bearer header, so the
 * web app's card grid loads these directly. The 64-hex sha256 path is
 * unguessable (the same posture as the public share slug), the content is a
 * public website image, and it is immutable per hash — so both the browser and
 * the edge cache it aggressively. Sits under /api/public/* so the cache-policy
 * middleware exempts it from no-store.
 *
 * Rate limited via the DEDICATED ASSET_RATE_LIMITER binding (600/min per IP —
 * a cold-cache grid bursts 100-200 requests, far past the shared auth-plane
 * binding's 60/min). Without that binding, the D1 dual bucket applies
 * (per-IP + global, minute window); see consumeAssetRateLimit.
 */

const HASH_PATTERN = /^[0-9a-f]{64}$/
const KINDS = new Set(['favicon', 'cover'])

const ASSET_IP_LIMITS: RateLimitConfig = { per_minute: 300, per_hour: 3000, per_day: 30000 }
const ASSET_GLOBAL_LIMITS: RateLimitConfig = { per_minute: 3000, per_hour: 30000, per_day: 300000 }

async function serveAsset(c: Context<AppEnv>): Promise<Response> {
  const kind = c.req.param('kind')
  const hash = c.req.param('hash')
  if (!kind || !KINDS.has(kind) || !hash || !HASH_PATTERN.test(hash)) {
    return notFound('Asset not found')
  }
  if (!c.env.SNAPSHOTS) return internalError('Asset storage is not configured', 'SNAPSHOT_STORAGE_UNAVAILABLE')

  const rate = await consumeAssetRateLimit(c.env, getClientIp(c.req.raw), ASSET_IP_LIMITS, ASSET_GLOBAL_LIMITS)
  if (!rate.allowed) {
    return tooManyRequests(
      { code: 'RATE_LIMITED', message: 'Too many requests' },
      { 'Retry-After': String(rate.retryAfter || 60) }
    )
  }

  try {
    // Edge cache first (mirror public-share): hash-keyed content is immutable,
    // a hit skips both the R2 read and the cache write below.
    try {
      const cached = await caches.default.match(new Request(c.req.url, { method: 'GET' }))
      if (cached) return cached
    } catch {
      /* edge cache unavailable (local dev) — fall through to R2 */
    }

    const object = await c.env.SNAPSHOTS.get(`assets/${kind}/${hash}`)
    if (!object?.body) return notFound('Asset not found')

    // Hash-keyed content is immutable — one year, client + edge.
    const headers = new Headers({
      'Content-Type': object.httpMetadata?.contentType || 'application/octet-stream',
      'Cache-Control': 'public, max-age=31536000, s-maxage=604800, immutable',
      'X-Content-Type-Options': 'nosniff',
      ETag: `"${hash}"`,
    })
    if (c.req.header('If-None-Match') === `"${hash}"`) {
      return new Response(null, { status: 304, headers })
    }

    const response = new Response(object.body, { status: 200, headers })
    try {
      c.executionCtx.waitUntil(caches.default.put(new Request(c.req.url, { method: 'GET' }), response.clone()))
    } catch {
      /* edge cache unavailable (local dev) — serve directly */
    }
    return response
  } catch (error) {
    console.error('Asset fetch error:', error)
    return internalError('Failed to load asset')
  }
}

export const publicAssetRoutes = new Hono<AppEnv>()
publicAssetRoutes.get('/:kind/:hash', (c) => serveAsset(c))
