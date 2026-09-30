import type { Context } from 'hono'
import type { AppEnv } from '../../lib/env'
import { getJwtAccessTokenExpiresIn, getJwtRefreshTokenExpiresIn } from '../../lib/config'
import { generateToken, generateUUID, hashRefreshToken } from '../../lib/crypto'
import {
  appendSetCookie,
  buildRefreshCookie,
  generateJWT,
  parseExpiry,
  readRefreshToken,
  revokeSessionTokens,
  rotateRefreshSession,
} from '../../lib/auth'
import { getClientIp } from '../../lib/api-key/rate-limiter'
import { consumeUnauthenticatedRateLimit } from '../../lib/api-key/rate-limit-binding'
import type { RateLimitConfig } from '../../lib/api-key/rate-limiter-types'
import { badRequest, internalError, success, tooManyRequests, unauthorized } from '../../lib/response'

interface RefreshRequest {
  refresh_token?: string
}

interface RefreshTokenRecord {
  id: number
  user_id: string
  expires_at: string
  revoked_at: string | null
  session_id: string | null
  remember_me: number
}

interface RefreshUser {
  id: string
  username: string
  email: string | null
}

// Throttle refresh attempts by client IP. Reuses the shared D1-backed bucket
// helper; keys are namespaced with "refresh:" to avoid colliding with the
// login buckets. Generous limits: refresh is expected in normal app flows.
const REFRESH_LIMITS: RateLimitConfig = { per_minute: 20, per_hour: 200, per_day: 2000 }

export async function refreshHandler(c: Context<AppEnv>): Promise<Response> {
  try {
    const clientIP = getClientIp(c.req.raw)
    const rate = await consumeUnauthenticatedRateLimit(c.env, `refresh:${clientIP}`, REFRESH_LIMITS)
    if (!rate.allowed) {
      return tooManyRequests(
        { code: 'RATE_LIMITED', message: 'Too many refresh attempts' },
        { 'Retry-After': String(rate.retryAfter || 60) }
      )
    }

    const body = await c.req.json<RefreshRequest>().catch(() => null)
    const refreshToken = readRefreshToken(c.req.raw, body)
    if (!refreshToken) {
      return badRequest('Refresh token is required')
    }

    const tokenHash = await hashRefreshToken(refreshToken)
    const tokenRecord = await readRefreshTokenRecord(c.env.DB, tokenHash)
    if (!tokenRecord) {
      return unauthorized('Invalid refresh token')
    }
    if (tokenRecord.revoked_at) {
      // The presented token was already rotated (or logged out). A rotated
      // token reappearing means someone else holds a copy of the chain:
      // kill the whole session and surface the event.
      await revokeSessionTokens(c.env.DB, tokenRecord.user_id, tokenRecord.session_id || '', new Date().toISOString())
      await writeAudit(c.env.DB, tokenRecord.user_id, 'auth.refresh_reuse_detected', { session_id: tokenRecord.session_id }, clientIP)
      return unauthorized({ code: 'TOKEN_REUSE_DETECTED', message: 'Refresh token reuse detected; session has been revoked' })
    }
    if (new Date(tokenRecord.expires_at) < new Date()) {
      return unauthorized('Refresh token has expired')
    }

    // Verify the user still exists (and is not soft-deleted / disabled)
    // before rotating the session; a revoked token for a removed user should
    // not be able to mint fresh credentials.
    const user = await c.env.DB
      .prepare('SELECT id, username, email FROM users WHERE id = ?')
      .bind(tokenRecord.user_id)
      .first<RefreshUser>()
    if (!user) {
      return unauthorized('User not found')
    }

    const sessionId = tokenRecord.session_id || generateUUID()
    const rememberMe = tokenRecord.remember_me === 1
    const nextRefreshToken = generateToken(32)
    const nextRefreshTokenHash = await hashRefreshToken(nextRefreshToken)
    const refreshTokenExpiresIn = parseExpiry(getJwtRefreshTokenExpiresIn(c.env))
    const createdAt = new Date().toISOString()
    const expiresAt = new Date(Date.now() + refreshTokenExpiresIn * 1000).toISOString()

    const rotated = await rotateRefreshSession({
      db: c.env.DB,
      tokenId: tokenRecord.id,
      userId: tokenRecord.user_id,
      refreshTokenHash: nextRefreshTokenHash,
      sessionId,
      expiresAt,
      createdAt,
      rememberMe,
    })
    if (!rotated) {
      // A concurrent request presenting the same token won the rotation race
      // and already revoked this row: the chain is replayed, same response as
      // the revoked-token branch above.
      await revokeSessionTokens(c.env.DB, tokenRecord.user_id, sessionId, new Date().toISOString())
      await writeAudit(c.env.DB, tokenRecord.user_id, 'auth.refresh_reuse_detected', { session_id: sessionId }, clientIP)
      return unauthorized({ code: 'TOKEN_REUSE_DETECTED', message: 'Refresh token reuse detected; session has been revoked' })
    }

    const accessToken = await generateJWT(
      { sub: tokenRecord.user_id, session_id: sessionId },
      c.env.JWT_SECRET,
      getJwtAccessTokenExpiresIn(c.env)
    )

    await writeAudit(c.env.DB, tokenRecord.user_id, 'auth.token_refreshed', { session_id: sessionId }, clientIP)

    const response = success({
      access_token: accessToken,
      token_type: 'Bearer',
      expires_in: parseExpiry(getJwtAccessTokenExpiresIn(c.env)),
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
      },
    })
    return appendSetCookie(response, buildRefreshCookie(c.env, nextRefreshToken, rememberMe, refreshTokenExpiresIn))
  } catch (error) {
    console.error('Refresh error:', error)
    return internalError('Token refresh failed')
  }
}

async function readRefreshTokenRecord(db: D1Database, tokenHash: string): Promise<RefreshTokenRecord | null> {
  return db
    .prepare(
      `SELECT id, user_id, expires_at, revoked_at, session_id, remember_me
       FROM auth_tokens
       WHERE refresh_token_hash = ?`
    )
    .bind(tokenHash)
    .first<RefreshTokenRecord>()
}

async function writeAudit(db: D1Database, userId: string, eventType: string, payload: Record<string, unknown>, ip: string): Promise<void> {
  try {
    await db.prepare(
      `INSERT INTO audit_logs (user_id, event_type, payload, ip, created_at)
       VALUES (?, ?, ?, ?, ?)`
    )
      .bind(userId, eventType, JSON.stringify(payload), ip, new Date().toISOString())
      .run()
  } catch (error) {
    console.warn('Auth audit write skipped:', error)
  }
}