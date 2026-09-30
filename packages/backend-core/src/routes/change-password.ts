import { Hono } from 'hono'
import type { Context } from 'hono'
import type { AppEnv } from '../lib/env'
import { getPbkdf2Iterations } from '../lib/config'
import { badRequest, internalError, success, tooManyRequests, unauthorized } from '../lib/response'
import { requireAuth } from '../middleware/auth'
import { consumeRateLimit } from '../lib/api-key/rate-limiter'
import type { RateLimitConfig } from '../lib/api-key/rate-limiter-types'
import { hashPassword, verifyPassword } from '../lib/crypto'

const MAX_PASSWORD_LENGTH = 128

// Each attempt pays two PBKDF2 rounds (verify + hash, both at the env-configured
// iteration count); bound the endpoint on its own so a valid token cannot turn
// it into a CPU burner.
const CHANGE_PASSWORD_LIMITS: RateLimitConfig = { per_minute: 5, per_hour: 20, per_day: 50 }

async function changePasswordHandler(c: Context<AppEnv>): Promise<Response> {
  const auth = c.get('auth')
  if (!auth) return internalError('User not found')
  const userId = auth.user_id

  try {
    const rate = await consumeRateLimit(`change-password:${userId}`, c.env.DB, CHANGE_PASSWORD_LIMITS, { onError: 'deny' })
    if (!rate.allowed) {
      return tooManyRequests(
        { code: 'RATE_LIMITED', message: 'Too many password change attempts' },
        { 'Retry-After': String(rate.retryAfter || 60) }
      )
    }

    const body = await c.req.json<{ current_password: string; new_password: string }>()
    if (!body.current_password || !body.new_password) {
      return badRequest('Current password and new password are required')
    }
    if (body.new_password.length < 8) {
      return badRequest('New password must be at least 8 characters')
    }
    if (body.new_password.length > MAX_PASSWORD_LENGTH) {
      return badRequest(`New password must be at most ${MAX_PASSWORD_LENGTH} characters`, 'PASSWORD_TOO_LONG')
    }
    const user = await c.env.DB
      .prepare('SELECT password_hash FROM users WHERE id = ?')
      .bind(userId)
      .first<{ password_hash: string }>()
    if (!user) return unauthorized('User not found')

    const valid = await verifyPassword(body.current_password, user.password_hash)
    if (!valid) return unauthorized('Current password is incorrect')

    const newPasswordHash = await hashPassword(body.new_password, getPbkdf2Iterations(c.env))
    const now = new Date().toISOString()
    await c.env.DB.batch([
      c.env.DB.prepare('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?')
        .bind(newPasswordHash, now, userId),
      c.env.DB.prepare('UPDATE auth_tokens SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL')
        .bind(now, userId),
    ])

    // 审计:密码变更吊销全部会话,是账户安全的敏感事件,此前审计日志不可见。
    await writeSecurityAudit(c.env.DB, userId, 'auth.password_changed', { sessions_revoked: 'all' })

    return success({ message: 'Password changed successfully' })
  } catch (error) {
    console.error('Change password error:', error)
    return internalError('Failed to change password')
  }
}

/** 控制面安全事件审计(改密/密钥变更)。失败不阻塞主流程。 */
async function writeSecurityAudit(
  db: D1Database,
  userId: string,
  eventType: string,
  payload: Record<string, unknown>
): Promise<void> {
  try {
    await db
      .prepare(
        `INSERT INTO audit_logs (user_id, event_type, payload, created_at)
         VALUES (?, ?, ?, ?)`
      )
      .bind(userId, eventType, JSON.stringify(payload), new Date().toISOString())
      .run()
  } catch {
    /* audit is best-effort */
  }
}

/**
 * Change password for the JWT-authenticated web user. JWT-only (API keys have
 * no password), and revokes all active sessions on success. Mounted only on
 * the v1 entry.
 */
export const changePasswordRoutes = new Hono<AppEnv>()

changePasswordRoutes.post('/', requireAuth, changePasswordHandler)
