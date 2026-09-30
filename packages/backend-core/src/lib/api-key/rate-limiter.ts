import type { RateLimitConfig, RateLimitResult, RateLimitWindow } from './rate-limiter-types'
import { DEFAULT_LIMITS } from './rate-limiter-types'
import { getWindowSlots, type WindowSlot } from './rate-limiter-windows'

interface RateLimitOptions {
  /**
   * Behavior when the backing store throws. Defaults to 'allow' (the limiter
   * is a fallback for the Cloudflare Rate Limiting binding on API keys);
   * authentication endpoints pass 'deny' because a broken limiter must not
   * silently open a brute-force surface.
   */
  onError?: 'allow' | 'deny'
}

let ensureTablePromise: Promise<void> | null = null

async function ensureTable(db: D1Database): Promise<void> {
  if (ensureTablePromise) return ensureTablePromise

  ensureTablePromise = db
    .prepare(
      `CREATE TABLE IF NOT EXISTS api_key_rate_limits (
        api_key_id TEXT NOT NULL,
        window TEXT NOT NULL,
        window_start INTEGER NOT NULL,
        count INTEGER NOT NULL DEFAULT 0,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (api_key_id, window, window_start)
      )`
    )
    .run()
    .then(() => undefined)
    .catch(() => undefined)

  return ensureTablePromise
}

async function maybeCleanup(db: D1Database, now: number): Promise<void> {
  if (Math.random() < 0.01) {
    const cutoff = now - 7 * 86_400_000
    await db.prepare(`DELETE FROM api_key_rate_limits WHERE updated_at < ?`).bind(cutoff).run()
  }
}

async function getCounts(
  db: D1Database,
  apiKeyId: string,
  windows: Array<{ window: RateLimitWindow; windowStart: number }>
): Promise<Map<RateLimitWindow, number>> {
  const counts = new Map<RateLimitWindow, number>()
  windows.forEach((w) => counts.set(w.window, 0))

  const minute = windows.find((w) => w.window === 'minute')!
  const hour = windows.find((w) => w.window === 'hour')!
  const day = windows.find((w) => w.window === 'day')!

  const result = await db
    .prepare(
      `SELECT window, count
       FROM api_key_rate_limits
       WHERE api_key_id = ?
         AND (
           (window = 'minute' AND window_start = ?)
           OR (window = 'hour' AND window_start = ?)
           OR (window = 'day' AND window_start = ?)
         )`
    )
    .bind(apiKeyId, minute.windowStart, hour.windowStart, day.windowStart)
    .all<{ window: RateLimitWindow; count: number }>()

  ;(result.results || []).forEach((row) => {
    counts.set(row.window, Number(row.count) || 0)
  })

  return counts
}

/**
 * Check rate limit without incrementing counters.
 */
async function checkRateLimit(
  apiKeyId: string,
  db: D1Database,
  limits: RateLimitConfig = DEFAULT_LIMITS,
  options: RateLimitOptions = {}
): Promise<RateLimitResult> {
  const now = Date.now()

  try {
    await ensureTable(db)
    const windows = getWindowSlots(now, limits)
    const counts = await getCounts(db, apiKeyId, windows)

    let minuteAllowedResult: RateLimitResult | null = null

    for (const w of ['minute', 'hour', 'day'] as const) {
      const slot = windows.find((x) => x.window === w)!
      const limit = slot.limit
      const current = counts.get(w) || 0
      const reset = slot.reset
      const remaining = Math.max(0, limit - current)

      if (current >= limit) {
        return {
          allowed: false,
          window: w,
          limit,
          remaining: 0,
          reset,
          retryAfter: Math.max(0, Math.ceil((reset - now) / 1000)),
        }
      }

      if (w === 'minute') {
        minuteAllowedResult = {
          allowed: true,
          window: w,
          limit,
          remaining,
          reset,
        }
      }
    }

    return (
      minuteAllowedResult || {
        allowed: true,
        window: 'minute',
        limit: limits.per_minute,
        remaining: limits.per_minute,
        reset: now + 60_000,
      }
    )
  } catch {
    // Fail-open to avoid accidental outage on the API-key fallback path;
    // callers that need strictness pass onError: 'deny'.
    if (options.onError === 'deny') {
      return { allowed: false, window: 'minute', limit: limits.per_minute, remaining: 0, reset: now + 60_000, retryAfter: 60 }
    }
    return {
      allowed: true,
      window: 'minute',
      limit: limits.per_minute,
      remaining: limits.per_minute,
      reset: now + 60_000,
    }
  }
}

/**
 * windows:'minute' consumes one window (1 written row vs 3); auth endpoints
 * needing hour/day windows keep 'all'. Design trade-off for the API-key plane:
 * when self-hosted WITHOUT the native RATE_LIMITER binding, only the minute
 * window is enforced — hour/day ceilings do not apply on that fallback path.
 */
interface ConsumeRateLimitOptions extends RateLimitOptions {
  windows?: 'all' | 'minute'
}

/**
 * Atomically consume one request from all rate-limit windows if allowed.
 */
export async function consumeRateLimit(
  apiKeyId: string,
  db: D1Database,
  limits: RateLimitConfig = DEFAULT_LIMITS,
  options: ConsumeRateLimitOptions = {}
): Promise<RateLimitResult> {
  const now = Date.now()

  try {
    await ensureTable(db)
    const allWindows = getWindowSlots(now, limits)
    const windows = options.windows === 'minute' ? [allWindows[0]!] : allWindows
    const rows = await consumeWindows(apiKeyId, db, now, windows)
    await maybeCleanup(db, now)

    if (rows.length !== windows.length) {
      return checkRateLimit(apiKeyId, db, limits, options)
    }

    const minute = windows.find((slot) => slot.window === 'minute')!
    const minuteCount = Number(rows.find((row) => row.window === 'minute')?.count || 0)
    return {
      allowed: true,
      window: 'minute',
      limit: minute.limit,
      remaining: Math.max(0, minute.limit - minuteCount),
      reset: minute.reset,
    }
  } catch {
    if (options.onError === 'deny') {
      return { allowed: false, window: 'minute', limit: limits.per_minute, remaining: 0, reset: now + 60_000, retryAfter: 60 }
    }
    return {
      allowed: true,
      window: 'minute',
      limit: limits.per_minute,
      remaining: limits.per_minute,
      reset: now + 60_000,
    }
  }
}

/**
 * Best-effort client IP. Cloudflare sets CF-Connecting-IP; self-hosted
 * deployments behind a reverse proxy expose the client in the first
 * X-Forwarded-For hop. Auth endpoints additionally use per-username buckets,
 * so a spoofable IP only weakens the anonymous buckets.
 */
export function getClientIp(request: Request): string {
  const cf = request.headers.get('CF-Connecting-IP')
  if (cf) return cf
  const forwarded = request.headers.get('X-Forwarded-For')
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim()
    if (first) return first
  }
  return 'unknown'
}

async function consumeWindows(
  apiKeyId: string,
  db: D1Database,
  now: number,
  windows: WindowSlot[]
): Promise<Array<{ window: RateLimitWindow; count: number }>> {
  // Build the VALUES clause from the slots actually passed: callers using
  // windows:'minute' hand a single-element array, and the old fixed
  // ('minute','hour','day') destructure crashed on windows[1] — which the
  // catch above turned into fail-closed 429s on every auth request whenever
  // the native RATE_LIMITER binding was absent (self-host / local dev).
  // Window names come from the fixed WindowSlot set, never user input.
  const valuesSql = windows.map((slot) => `('${slot.window}', ?, ?)`).join(', ')
  const limitBinds: number[] = []
  for (const slot of windows) limitBinds.push(slot.windowStart, slot.limit)

  const result = await db
    .prepare(
      `WITH windows(window, window_start, limit_value) AS (
         VALUES ${valuesSql}
       )
       INSERT INTO api_key_rate_limits (api_key_id, window, window_start, count, updated_at)
       SELECT ?, window, window_start, 1, ?
       FROM windows
       WHERE NOT EXISTS (
         SELECT 1
         FROM api_key_rate_limits existing
         JOIN windows current_window
           ON current_window.window = existing.window
          AND current_window.window_start = existing.window_start
         WHERE existing.api_key_id = ?
           AND existing.count >= current_window.limit_value
       )
       ON CONFLICT(api_key_id, window, window_start)
       DO UPDATE SET count = api_key_rate_limits.count + 1, updated_at = excluded.updated_at
       RETURNING window, count`
    )
    .bind(...limitBinds, apiKeyId, now, apiKeyId)
    .all<{ window: RateLimitWindow; count: number }>()

  return result.results || []
}
