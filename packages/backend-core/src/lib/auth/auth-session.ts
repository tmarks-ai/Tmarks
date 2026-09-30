import type { Env } from '../env'

/**
 * Access tokens carry a session_id bound to the server-side auth_tokens rows.
 * A session is active while at least one of its rows is neither revoked nor
 * expired. Refresh rotation inserts a new row and revokes the old one in a
 * single atomic batch, so a presented token whose row is revoked is a reuse
 * signal (see routes/auth/refresh.ts).
 */
export async function isAccessSessionActive(
  env: Pick<Env, 'DB'>,
  userId: string,
  sessionId?: string
): Promise<boolean> {
  if (!sessionId) return false

  const row = await env.DB
    .prepare(
      `SELECT expires_at
       FROM auth_tokens
       WHERE user_id = ? AND session_id = ? AND revoked_at IS NULL
       ORDER BY created_at DESC, id DESC
       LIMIT 1`
    )
    .bind(userId, sessionId)
    .first<{ expires_at: string }>()

  if (!row) return false
  // Date-based comparison keeps legacy rows (stored via datetime('now'))
  // comparable with the ISO-8601 timestamps the new code writes.
  const expiresAt = new Date(row.expires_at)
  return !Number.isNaN(expiresAt.getTime()) && expiresAt > new Date()
}

export async function insertRefreshSession(input: {
  db: D1Database
  userId: string
  refreshTokenHash: string
  sessionId: string
  expiresAt: string
  createdAt: string
  rememberMe: boolean
}): Promise<void> {
  await input.db.prepare(
    `INSERT INTO auth_tokens (user_id, refresh_token_hash, session_id, expires_at, created_at, remember_me)
     VALUES (?, ?, ?, ?, ?, ?)`
  )
    .bind(input.userId, input.refreshTokenHash, input.sessionId, input.expiresAt, input.createdAt, input.rememberMe ? 1 : 0)
    .run()
}

/**
 * Rotate a refresh token: claim the presented row, insert the successor row
 * for the same session, and purge stale revoked rows so the table does not
 * grow without bound. Revoking (instead of deleting) the old row is what
 * makes reuse detection possible.
 *
 * The claim UPDATE runs on its own so `meta.changes` can be inspected: when
 * two concurrent requests present the same token, only the one whose UPDATE
 * flips `revoked_at` from NULL may mint a successor. The loser gets `false`
 * and the caller treats it as token reuse (revoke the whole session).
 */
export async function rotateRefreshSession(input: {
  db: D1Database
  tokenId: number
  userId: string
  refreshTokenHash: string
  sessionId: string
  expiresAt: string
  createdAt: string
  rememberMe: boolean
}): Promise<boolean> {
  const purgeCutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
  const claim = await input.db
    .prepare(
      `UPDATE auth_tokens SET revoked_at = ?
       WHERE id = ? AND user_id = ? AND revoked_at IS NULL`
    )
    .bind(input.createdAt, input.tokenId, input.userId)
    .run()
  if ((claim.meta?.changes ?? 0) !== 1) return false

  await input.db.batch([
    input.db.prepare(
      `INSERT INTO auth_tokens (user_id, refresh_token_hash, session_id, expires_at, created_at, remember_me)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).bind(input.userId, input.refreshTokenHash, input.sessionId, input.expiresAt, input.createdAt, input.rememberMe ? 1 : 0),
    input.db.prepare(
      `DELETE FROM auth_tokens WHERE user_id = ? AND revoked_at IS NOT NULL AND created_at < ?`
    ).bind(input.userId, purgeCutoff),
  ])
  return true
}

/** Revoke every token row of a session (used when a reused token is detected). */
export async function revokeSessionTokens(
  db: D1Database,
  userId: string,
  sessionId: string,
  revokedAt: string
): Promise<void> {
  await db.prepare(
    `UPDATE auth_tokens SET revoked_at = ? WHERE user_id = ? AND session_id = ? AND revoked_at IS NULL`
  )
    .bind(revokedAt, userId, sessionId)
    .run()
}