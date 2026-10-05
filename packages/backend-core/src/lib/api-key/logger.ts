/**
 * API Key Logger - Records API key usage and provides statistics.
 * Automatically cleans up old logs, keeping only the latest 100 entries per key.
 */

interface LogEntry {
  api_key_id: string
  user_id: string
  endpoint: string
  method: string
  status: number
  ip: string | null
}

export async function logApiKeyUsage(entry: LogEntry, db: D1Database): Promise<void> {
  try {
    await db
      .prepare(
        `INSERT INTO api_key_logs (api_key_id, user_id, endpoint, method, status, ip)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .bind(
        entry.api_key_id,
        entry.user_id,
        entry.endpoint,
        entry.method,
        entry.status,
        entry.ip
      )
      .run()

    // R8 BL-8: await the cleanup into THIS promise so the caller's waitUntil
    // covers it (previously detached via a bare void — the isolate could
    // settle mid-DELETE and drop it).
    await maybeCleanupOldLogs(entry.api_key_id, db)
  } catch (error) {
    console.error('Failed to log API key usage:', error)
  }
}

/**
 * Count-cap + 90-day purge, run on ~1% of inserts. The unconditional DELETE
 * cost one extra D1 statement on every single API-key-authenticated request;
 * visitor IPs must not sit in the table forever on a low-traffic key either.
 *
 * R8 BL-8: returned as part of logApiKeyUsage's promise so the caller's
 * waitUntil keeps it alive. The old bare `void` IIFE detached it from the
 * waitUntil'd chain — the isolate could settle mid-DELETE and drop it (the
 * same platform trap the audit-retention sweep hit and fixed, R5-7).
 */
async function maybeCleanupOldLogs(apiKeyId: string, db: D1Database): Promise<void> {
  if (Math.random() >= 0.01) return
  try {
    await db
      .prepare(
        `DELETE FROM api_key_logs
         WHERE api_key_id = ?
         AND (created_at < ? OR id NOT IN (
           SELECT id FROM api_key_logs
           WHERE api_key_id = ?
           ORDER BY created_at DESC
           LIMIT 100
         ))`
      )
      .bind(apiKeyId, new Date(Date.now() - 90 * 24 * 3600_000).toISOString(), apiKeyId)
      .run()
  } catch (error) {
    console.error('Failed to cleanup old logs:', error)
  }
}

// R8 CA-11: getApiKeyLogs removed with the dead /settings/api-keys/:id/logs
// route — no UI or contract ever consumed it. The write path and
// getApiKeyStats (consumed by the key-detail route) stay.

export async function getApiKeyStats(
  apiKeyId: string,
  userId: string,
  db: D1Database
): Promise<{
  total_requests: number
  last_used_at: string | null
  last_used_ip: string | null
}> {
  const result = await db
    .prepare(
      `SELECT
         COUNT(*) as total_requests,
         MAX(created_at) as last_used_at,
         (SELECT ip FROM api_key_logs
          WHERE api_key_id = ? AND user_id = ?
          ORDER BY created_at DESC
          LIMIT 1) as last_used_ip
       FROM api_key_logs
       WHERE api_key_id = ? AND user_id = ?`
    )
    .bind(apiKeyId, userId, apiKeyId, userId)
    .first()

  return (result ?? {
    total_requests: 0,
    last_used_at: null,
    last_used_ip: null,
  }) as {
    total_requests: number
    last_used_at: string | null
    last_used_ip: string | null
  }
}
