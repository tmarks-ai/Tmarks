import type { Context } from 'hono'
import type { AppEnv } from '../../lib/env'
import { getJwtAccessTokenExpiresIn, getJwtRefreshTokenExpiresIn, getPbkdf2Iterations } from '../../lib/config'
import { generateToken, generateUUID, hashPassword, hashRefreshToken, verifyPassword } from '../../lib/crypto'
import { appendSetCookie, buildRefreshCookie, generateJWT, insertRefreshSession, parseExpiry } from '../../lib/auth'
import { consumeRateLimit, getClientIp } from '../../lib/api-key/rate-limiter'
import { consumeUnauthenticatedRateLimit } from '../../lib/api-key/rate-limit-binding'
import type { RateLimitConfig } from '../../lib/api-key/rate-limiter-types'
import { badRequest, internalError, success, tooManyRequests, unauthorized } from '../../lib/response'

interface LoginRequest {
  username: string
  password: string
  remember_me?: boolean
}

interface LoginUser {
  id: string
  username: string
  email: string | null
  password_hash: string
}

const MAX_PASSWORD_LENGTH = 128

// 30 login attempts per IP per minute; per-username buckets stop distributed
// brute force against a single account. The global bucket bounds spraying
// when a self-hosted proxy lets clients forge X-Forwarded-For (per-IP bucket
// bypass), mirroring register/public-share.
const LOGIN_IP_LIMITS: RateLimitConfig = { per_minute: 30, per_hour: 600, per_day: 5000 }
const LOGIN_USER_LIMITS: RateLimitConfig = { per_minute: 10, per_hour: 60, per_day: 500 }
const LOGIN_GLOBAL_LIMITS: RateLimitConfig = { per_minute: 120, per_hour: 1200, per_day: 12000 }

// Fixed dummy hash so that a "user not found" response performs the same
// PBKDF2 work as a "wrong password" response, closing the timing side channel.
// Derived with the SAME env-configured iteration count as real password hashes
// (getPbkdf2Iterations): the module-level constant previously hard-coded
// crypto.ts's 600k default, which the Workers runtime hard-rejects above 100k
// (NotSupportedError) — turning every unknown-username login into a 500 and
// reintroducing the account-existence oracle the uniform 401 exists to close.
// Cached per iteration count (env is stable per deployment; per-count keys keep
// tests that vary PBKDF2_ITERATIONS from poisoning each other).
const DUMMY_HASH_BY_ITERATIONS = new Map<number, Promise<string>>()

/** Exported for tests: asserts the dummy work factor follows the env config. */
export function getDummyHashForLogin(iterations: number): Promise<string> {
  let promise = DUMMY_HASH_BY_ITERATIONS.get(iterations)
  if (!promise) {
    promise = hashPassword('tmarks-dummy-timing-equalizer', iterations)
    // R5-6: a REJECTED promise cached for the isolate's lifetime poisoned every
    // subsequent unknown-username login (500 forever, while wrong-password
    // stayed 401 — an account-existence oracle under a config mistake). Drop
    // the entry on rejection so the next request retries (and a fixed config
    // takes effect without waiting for a fresh isolate).
    promise.catch(() => {
      if (DUMMY_HASH_BY_ITERATIONS.get(iterations) === promise) {
        DUMMY_HASH_BY_ITERATIONS.delete(iterations)
      }
    })
    DUMMY_HASH_BY_ITERATIONS.set(iterations, promise)
  }
  return promise
}

/**
 * Timing-equalizer verification that cannot 500. A PBKDF2 config mistake
 * (e.g. PBKDF2_ITERATIONS above the Workers 100k cap) makes the dummy hash
 * derivation throw; surfacing that here would answer "unknown username" with
 * 500 while "wrong password" still answers 401 — the exact oracle the
 * uniform 401 exists to close (R5-6). Skip the equalizer work instead.
 */
async function tryDummyVerify(password: string, env: AppEnv['Bindings']): Promise<void> {
  try {
    await verifyPassword(password, await getDummyHashForLogin(getPbkdf2Iterations(env)))
  } catch {
    /* the uniform 401 below carries the response either way */
  }
}

export async function loginHandler(c: Context<AppEnv>): Promise<Response> {
  try {
    const clientIP = getClientIp(c.req.raw)
    const rate = await consumeUnauthenticatedRateLimit(c.env, `login:${clientIP}`, LOGIN_IP_LIMITS)
    if (!rate.allowed) {
      return tooManyRequests(
        { code: 'RATE_LIMITED', message: 'Too many login attempts' },
        { 'Retry-After': String(rate.retryAfter || 60) }
      )
    }

    const body = await c.req.json<LoginRequest>()
    if (!body.username || !body.password) {
      return badRequest('Username and password are required')
    }

    const loginIdentifier = body.username.trim().toLowerCase().slice(0, 256)

    // Consume the per-identifier bucket for every attempt, before the user
    // lookup: an existing and a non-existing username must eventually hit the
    // same 429, otherwise the throttling itself becomes an account-existence
    // oracle on top of the uniform 401 below.
    for (const [key, limits, exactD1] of [
      ['login:global', LOGIN_GLOBAL_LIMITS, false],
      // The per-username bucket needs its own tighter 10/min rate, which the
      // single-rate native binding cannot express — keep it on D1 (minute
      // window only; the IP/global buckets above already absorbed the flood).
      [`login-user:${loginIdentifier}`, LOGIN_USER_LIMITS, true],
    ] as const) {
      const bucket = exactD1
        ? await consumeRateLimit(key, c.env.DB, limits, { onError: 'deny', windows: 'minute' })
        : await consumeUnauthenticatedRateLimit(c.env, key, limits)
      if (!bucket.allowed) {
        return tooManyRequests(
          { code: 'RATE_LIMITED', message: 'Too many login attempts' },
          { 'Retry-After': String(bucket.retryAfter || 60) }
        )
      }
    }

    const user = await c.env.DB.prepare(
      `SELECT id, username, email, password_hash
       FROM users
       WHERE LOWER(username) = ? OR LOWER(email) = ?`
    )
      .bind(loginIdentifier, loginIdentifier)
      .first<LoginUser>()

    if (!user) {
      // Equalize timing with the real verification path.
      await tryDummyVerify(body.password.slice(0, MAX_PASSWORD_LENGTH), c.env)
      // 10% sampling: under a 40k/day credential-stuffing run, per-attempt
      // audit inserts alone would eat a large share of the daily write quota.
      // The rate-limit buckets (not the audit log) carry the protection.
      if (Math.random() < 0.1) {
        await writeLoginAudit(c.env.DB, {
          eventType: 'auth.login_failed',
          payload: { username: auditUsername(body.username), reason: 'user_not_found', sampled: true },
          ip: clientIP,
        })
      }
      return unauthorized('Invalid username or password')
    }

    // Cap PBKDF2 input: oversized passwords are rejected without paying
    // attacker-controlled CPU cost, but still run the dummy work for timing.
    const isValid = body.password.length <= MAX_PASSWORD_LENGTH
      ? await verifyPassword(body.password, user.password_hash)
      : false
    if (!isValid) {
      if (body.password.length > MAX_PASSWORD_LENGTH) {
        await tryDummyVerify('oversized-password-rejected', c.env)
      }
      if (Math.random() < 0.1) {
        await writeLoginAudit(c.env.DB, {
          userId: user.id,
          eventType: 'auth.login_failed',
          payload: { username: auditUsername(body.username), reason: 'invalid_password', sampled: true },
          ip: clientIP,
        })
      }
      return unauthorized('Invalid username or password')
    }

    const sessionId = generateUUID()
    const accessTokenExpiresInStr = getJwtAccessTokenExpiresIn(c.env)
    const accessTokenExpiresIn = parseExpiry(accessTokenExpiresInStr)
    const accessToken = await generateJWT(
      { sub: user.id, session_id: sessionId },
      c.env.JWT_SECRET,
      accessTokenExpiresInStr
    )

    const refreshToken = generateToken(32)
    const refreshTokenHash = await hashRefreshToken(refreshToken)
    const refreshTokenExpiresIn = parseExpiry(getJwtRefreshTokenExpiresIn(c.env))
    const refreshTokenExpiresAt = new Date(Date.now() + refreshTokenExpiresIn * 1000)
    const rememberMe = body.remember_me === true

    await insertRefreshSession({
      db: c.env.DB,
      userId: user.id,
      refreshTokenHash,
      sessionId,
      expiresAt: refreshTokenExpiresAt.toISOString(),
      createdAt: new Date().toISOString(),
      rememberMe,
    })

    await writeLoginAudit(c.env.DB, {
      userId: user.id,
      eventType: 'auth.login_success',
      payload: { session_id: sessionId, remember_me: rememberMe },
      ip: clientIP,
      userAgent: c.req.header('User-Agent') || 'unknown',
    })

    // The refresh token is delivered only as an HttpOnly cookie; it is never
    // exposed to JavaScript so an XSS cannot exfiltrate the long-lived session.
    const response = success({
      access_token: accessToken,
      token_type: 'Bearer',
      expires_in: accessTokenExpiresIn,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
      },
    })
    return appendSetCookie(response, buildRefreshCookie(c.env, refreshToken, rememberMe, refreshTokenExpiresIn))
  } catch (error) {
    console.error('Login error:', error)
    return internalError('Login failed')
  }
}

/** 审计负载里的用户名:截断,畸形类型安全化(攻击者可控的自由字符串)。 */
function auditUsername(username: unknown): string {
  return typeof username === 'string' ? username.slice(0, 64) : '[invalid]'
}

async function writeLoginAudit(
  db: D1Database,
  input: {
    eventType: string
    payload: Record<string, unknown>
    ip: string
    userId?: string
    userAgent?: string
  }
): Promise<void> {
  try {
    const now = new Date().toISOString()
    if (input.userId && input.userAgent) {
      await db
        .prepare(
          `INSERT INTO audit_logs (user_id, event_type, payload, ip, user_agent, created_at)
           VALUES (?, ?, ?, ?, ?, ?)`
        )
        .bind(input.userId, input.eventType, JSON.stringify(input.payload), input.ip, input.userAgent, now)
        .run()
      return
    }
    if (input.userId) {
      await db
        .prepare(
          `INSERT INTO audit_logs (user_id, event_type, payload, ip, created_at)
           VALUES (?, ?, ?, ?, ?)`
        )
        .bind(input.userId, input.eventType, JSON.stringify(input.payload), input.ip, now)
        .run()
      return
    }
    await db
      .prepare(
        `INSERT INTO audit_logs (event_type, payload, ip, created_at)
         VALUES (?, ?, ?, ?)`
      )
      .bind(input.eventType, JSON.stringify(input.payload), input.ip, now)
      .run()
  } catch (error) {
    console.warn('Login audit write skipped:', error)
  }
}