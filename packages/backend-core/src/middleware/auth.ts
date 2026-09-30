import type { MiddlewareHandler } from 'hono'
import type { AppEnv, AuthContext } from '../lib/env'
import { extractJWT, isAccessSessionActive, verifyJWT } from '../lib/auth'
import { consumeRateLimit } from '../lib/api-key/rate-limiter'
import { tooManyRequests, unauthorized } from '../lib/response'

// Generous per-user bucket for the JWT (web) plane: the API-key plane has its
// own limiter, but before this the JWT plane had none — a holder of a valid
// 1-hour token (e.g. an XSS payload) could hammer D1/Workers CPU without
// bound. Fail-open like the API-key limiter: the data plane must not brick
// because the limiter's backing store hiccups; auth endpoints stay fail-closed.
const JWT_USER_LIMITS = { per_minute: 240, per_hour: 4000, per_day: 40000 }

/**
 * JWT-only authentication (the web-app flow). Requires a `Bearer` token; API
 * keys are not accepted here. On success the authenticated principal is stored
 * in `c.get('auth')` with `auth_type: 'jwt'`.
 */
export const requireAuth: MiddlewareHandler<AppEnv> = async (c, next) => {
  const token = extractJWT(c.req.raw)
  if (!token) {
    return unauthorized('Missing authorization token')
  }

  try {
    const payload = await verifyJWT(token, c.env.JWT_SECRET)
    if (!payload || !payload.sub) {
      return unauthorized({ code: 'INVALID_TOKEN', message: 'Invalid or expired token' })
    }
    if (!(await isAccessSessionActive(c.env, payload.sub, payload.session_id))) {
      return unauthorized({ code: 'SESSION_REVOKED', message: 'Session has been revoked' })
    }

    const rate = await consumeRateLimit(`jwt:${payload.sub}`, c.env.DB, JWT_USER_LIMITS, { windows: 'minute' })
    if (!rate.allowed) {
      return tooManyRequests(
        { code: 'RATE_LIMITED', message: 'Too many requests' },
        { 'Retry-After': String(rate.retryAfter || 60) }
      )
    }

    const auth: AuthContext = { user_id: payload.sub, auth_type: 'jwt', session_id: payload.session_id }
    c.set('auth', auth)
    await next()
  } catch {
    return unauthorized({ code: 'INVALID_TOKEN', message: 'Invalid or expired token' })
  }
}
