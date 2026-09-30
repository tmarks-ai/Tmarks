import type { Context } from 'hono'
import type { AppEnv } from '../../lib/env'
import { hashRefreshToken } from '../../lib/crypto'
import { appendSetCookie, buildRefreshCookieCleared, readRefreshToken, revokeSessionTokens } from '../../lib/auth'
import { badRequest, internalError, noContent } from '../../lib/response'

interface LogoutRequest {
  refresh_token?: string
  revoke_all?: boolean
}

export async function logoutHandler(c: Context<AppEnv>): Promise<Response> {
  try {
    const body = await c.req.json<LogoutRequest>().catch(() => null)
    const refreshToken = readRefreshToken(c.req.raw, body)

    const auth = c.get('auth')
    const userId = auth?.user_id
    if (!userId) {
      return badRequest('Authenticated user is required')
    }
    const now = new Date().toISOString()
    const ip = c.req.header('CF-Connecting-IP') || 'unknown'

    if (body?.revoke_all) {
      await c.env.DB.prepare(
        `UPDATE auth_tokens
         SET revoked_at = ?
         WHERE user_id = ? AND revoked_at IS NULL`
      )
        .bind(now, userId)
        .run()

      await c.env.DB.prepare(
        `INSERT INTO audit_logs (user_id, event_type, payload, ip, created_at)
         VALUES (?, 'auth.logout_all_devices', ?, ?, ?)`
      )
        .bind(userId, JSON.stringify({ revoked_count: 'all' }), ip, now)
        .run()
    } else if (refreshToken) {
      const tokenHash = await hashRefreshToken(refreshToken)
      await c.env.DB.prepare(
        `UPDATE auth_tokens
         SET revoked_at = ?
         WHERE refresh_token_hash = ? AND user_id = ? AND revoked_at IS NULL`
      )
        .bind(now, tokenHash, userId)
        .run()

      await c.env.DB.prepare(
        `INSERT INTO audit_logs (user_id, event_type, payload, ip, created_at)
         VALUES (?, 'auth.logout', ?, ?, ?)`
      )
        .bind(userId, JSON.stringify({ single_device: true }), ip, now)
        .run()
    } else if (auth.session_id) {
      // No refresh cookie was presented (cleared, cross-site, or a third-party
      // copy). The access token still names the session it belongs to, and the
      // middleware has already verified that session is active — revoke it so
      // logout actually terminates this device's server-side session instead
      // of leaving the token chain alive for up to 30 days.
      await revokeSessionTokens(c.env.DB, userId, auth.session_id, now)

      await c.env.DB.prepare(
        `INSERT INTO audit_logs (user_id, event_type, payload, ip, created_at)
         VALUES (?, 'auth.logout', ?, ?, ?)`
      )
        .bind(userId, JSON.stringify({ single_device: true, by_session: true }), ip, now)
        .run()
    }

    const response = noContent()
    return appendSetCookie(response, buildRefreshCookieCleared(c.env))
  } catch (error) {
    console.error('Logout error:', error)
    return internalError('Logout failed')
  }
}