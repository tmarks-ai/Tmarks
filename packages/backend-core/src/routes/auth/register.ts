import type { Context } from 'hono'
import type { AppEnv } from '../../lib/env'
import { getPbkdf2Iterations } from '../../lib/config'
import { generateUUID, hashPassword } from '../../lib/crypto'
import { getClientIp } from '../../lib/api-key/rate-limiter'
import { consumeUnauthenticatedRateLimit } from '../../lib/api-key/rate-limit-binding'
import type { RateLimitConfig } from '../../lib/api-key/rate-limiter-types'
import { badRequest, forbidden, internalError, success, tooManyRequests } from '../../lib/response'

interface RegisterRequest {
  username: string
  email?: string | null
  password: string
}

interface ExistingUser {
  id: string
}

const MIN_PASSWORD_LENGTH = 8
const MAX_PASSWORD_LENGTH = 128
const MAX_USERNAME_LENGTH = 64
const MAX_EMAIL_LENGTH = 254
const USERNAME_PATTERN = /^[a-zA-Z0-9_.-]+$/
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

// Per-IP buckets plus a global bucket: the global bucket keeps spam bounded
// even when a self-hosted deployment cannot see a trustworthy client IP.
const REGISTER_IP_LIMITS: RateLimitConfig = { per_minute: 5, per_hour: 20, per_day: 100 }
const REGISTER_GLOBAL_LIMITS: RateLimitConfig = { per_minute: 30, per_hour: 120, per_day: 600 }

/** POST /register — create a new user when ALLOW_REGISTRATION is explicitly 'true'. */
export async function registerHandler(c: Context<AppEnv>): Promise<Response> {
  if (c.env.ALLOW_REGISTRATION !== 'true') {
    return forbidden('Registration is disabled', 'REGISTRATION_DISABLED')
  }

  try {
    const clientIP = getClientIp(c.req.raw)
    for (const [key, limits] of [
      [`register:${clientIP}`, REGISTER_IP_LIMITS],
      ['register:global', REGISTER_GLOBAL_LIMITS],
    ] as const) {
      const rate = await consumeUnauthenticatedRateLimit(c.env, key, limits)
      if (!rate.allowed) {
        return tooManyRequests(
          { code: 'RATE_LIMITED', message: 'Too many registration attempts' },
          { 'Retry-After': String(rate.retryAfter || 60) }
        )
      }
    }

    const body = await c.req.json<RegisterRequest>()
    const username = body.username?.trim() ?? ''
    const email = body.email?.trim() || null

    if (!username || !body.password) {
      return badRequest('Username and password are required')
    }
    if (username.length > MAX_USERNAME_LENGTH) {
      return badRequest(`Username must be at most ${MAX_USERNAME_LENGTH} characters long`, 'USERNAME_TOO_LONG')
    }
    if (!USERNAME_PATTERN.test(username)) {
      return badRequest('Username can only contain letters, numbers, dots, underscores and hyphens', 'INVALID_USERNAME')
    }
    if (body.password.length < MIN_PASSWORD_LENGTH) {
      return badRequest(`Password must be at least ${MIN_PASSWORD_LENGTH} characters long`, 'PASSWORD_TOO_SHORT')
    }
    if (body.password.length > MAX_PASSWORD_LENGTH) {
      return badRequest(`Password must be at most ${MAX_PASSWORD_LENGTH} characters long`, 'PASSWORD_TOO_LONG')
    }
    if (email && (email.length > MAX_EMAIL_LENGTH || !EMAIL_PATTERN.test(email))) {
      return badRequest('Email address is invalid', 'INVALID_EMAIL')
    }

    const existing = await c.env.DB
      .prepare('SELECT id FROM users WHERE LOWER(username) = ? OR (email IS NOT NULL AND LOWER(email) = ?)')
      .bind(username.toLowerCase(), email ? email.toLowerCase() : '')
      .first<ExistingUser>()

    if (existing) {
      return badRequest('Username or email already exists', 'CONFLICT')
    }

    const userId = generateUUID()
    const passwordHash = await hashPassword(body.password, getPbkdf2Iterations(c.env))
    const now = new Date().toISOString()

    await c.env.DB
      .prepare(
        `INSERT INTO users (id, username, email, password_hash, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .bind(userId, username.toLowerCase(), email, passwordHash, now, now)
      .run()

    // Registration audit (no user session exists yet; logged against the new id).
    try {
      await c.env.DB
        .prepare(
          `INSERT INTO audit_logs (user_id, event_type, payload, ip, created_at)
           VALUES (?, 'auth.registered', ?, ?, ?)`
        )
        .bind(userId, JSON.stringify({ username: username.toLowerCase().slice(0, 64), email: email ? email.slice(0, 128) : null }), clientIP, now)
        .run()
    } catch (error) {
      console.warn('Registration audit write skipped:', error)
    }

    return success(
      {
        user: {
          id: userId,
          username: username.toLowerCase(),
          email,
        },
      }
    )
  } catch (error) {
    // Two concurrent registrations with the same username/email both pass the
    // SELECT-then-INSERT check above; the loser hits the UNIQUE constraint.
    // Surface it as the same 400 CONFLICT the pre-check returns, not a 500.
    if (error instanceof Error && error.message.includes('UNIQUE constraint failed')) {
      return badRequest('Username or email already exists', 'CONFLICT')
    }
    console.error('Register error:', error)
    return internalError('Registration failed')
  }
}