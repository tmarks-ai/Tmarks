import { describe, expect, it } from 'vitest'
import {
  consumeRateLimit,
  type RateLimitConfig,
  type RateLimitWindow,
} from '@tmarks/backend-core'
import { createSqliteD1 } from './helpers/sqlite-d1'

describe('API key rate limiter', () => {
  it('consumes all windows together and rejects without overcounting after a limit is reached', async () => {
    const db = new RateLimitTestDb()
    const limits: RateLimitConfig = { per_minute: 1, per_hour: 3, per_day: 5 }

    const first = await consumeRateLimit('key_1', db as unknown as D1Database, limits)
    const second = await consumeRateLimit('key_1', db as unknown as D1Database, limits)

    expect(first).toMatchObject({ allowed: true, window: 'minute', limit: 1, remaining: 0 })
    expect(second).toMatchObject({ allowed: false, window: 'minute', limit: 1, remaining: 0 })
    expect(db.countFor('key_1', 'minute')).toBe(1)
    expect(db.countFor('key_1', 'hour')).toBe(1)
    expect(db.countFor('key_1', 'day')).toBe(1)
  })

  // Regression (found live while running local dev without the native
  // RATE_LIMITER binding): the minute-only fast path passed a single-element
  // window array into consumeWindows, whose fixed ('minute','hour','day')
  // destructure crashed on windows[1] — the catch then failed CLOSED, so
  // every login/register/refresh/public-share request answered 429 with an
  // empty rate-limit table. The same throw silently disabled the limiter
  // (fail-open) on the API-key and JWT planes. Must run the real SQL: the
  // in-memory fake above assumes exactly three windows and masks this.
  it('minute-window path consumes and denies against real SQLite', async () => {
    const harness = createSqliteD1('rl-user')
    const limits: RateLimitConfig = { per_minute: 2, per_hour: 10, per_day: 100 }
    const opts = { onError: 'deny', windows: 'minute' } as const

    const first = await consumeRateLimit('login:1.2.3.4', harness.db, limits, opts)
    const second = await consumeRateLimit('login:1.2.3.4', harness.db, limits, opts)
    const third = await consumeRateLimit('login:1.2.3.4', harness.db, limits, opts)

    expect(first.allowed).toBe(true)
    expect(second.allowed).toBe(true)
    expect(third).toMatchObject({ allowed: false, remaining: 0 })

    const rows = harness.sqlite
      .prepare('SELECT window, count FROM api_key_rate_limits WHERE api_key_id = ?')
      .all('login:1.2.3.4') as Array<{ window: string; count: number }>
    // Exactly one written row per consume (the D1-quota point of 'minute').
    expect(rows).toEqual([{ window: 'minute', count: 2 }])
    harness.close()
  })
})

class RateLimitTestDb {
  private readonly rows = new Map<string, number>()

  prepare(sql: string) {
    return new RateLimitTestStatement(this, sql)
  }

  run(sql: string) {
    return { success: true }
  }

  all<T>(sql: string, values: unknown[]) {
    const normalizedSql = normalizeSql(sql)
    if (normalizedSql.startsWith('select window, count from api_key_rate_limits')) {
      return { results: this.selectCounts(values) as T[], success: true }
    }
    if (normalizedSql.startsWith('with windows')) {
      return { results: this.consume(values) as T[], success: true }
    }
    return { results: [] as T[], success: true }
  }

  countFor(apiKeyId: string, window: RateLimitWindow): number {
    const row = Array.from(this.rows.entries()).find(([key]) => key.startsWith(`${apiKeyId}:${window}:`))
    return row?.[1] ?? 0
  }

  private selectCounts(values: unknown[]) {
    const apiKeyId = String(values[0])
    const windows = [
      { window: 'minute' as const, windowStart: Number(values[1]) },
      { window: 'hour' as const, windowStart: Number(values[2]) },
      { window: 'day' as const, windowStart: Number(values[3]) },
    ]
    return windows
      .map((slot) => ({ window: slot.window, count: this.rows.get(rowKey(apiKeyId, slot.window, slot.windowStart)) ?? 0 }))
      .filter((row) => row.count > 0)
  }

  private consume(values: unknown[]) {
    const windows = [
      { window: 'minute' as const, windowStart: Number(values[0]), limit: Number(values[1]) },
      { window: 'hour' as const, windowStart: Number(values[2]), limit: Number(values[3]) },
      { window: 'day' as const, windowStart: Number(values[4]), limit: Number(values[5]) },
    ]
    const apiKeyId = String(values[6])
    const overLimit = windows.some((slot) => {
      const count = this.rows.get(rowKey(apiKeyId, slot.window, slot.windowStart)) ?? 0
      return count >= slot.limit
    })
    if (overLimit) return []

    return windows.map((slot) => {
      const key = rowKey(apiKeyId, slot.window, slot.windowStart)
      const count = (this.rows.get(key) ?? 0) + 1
      this.rows.set(key, count)
      return { window: slot.window, count }
    })
  }
}

class RateLimitTestStatement {
  private values: unknown[] = []

  constructor(
    private readonly db: RateLimitTestDb,
    private readonly sql: string,
  ) {}

  bind(...values: unknown[]) {
    this.values = values
    return this
  }

  async run() {
    return this.db.run(this.sql)
  }

  async all<T>() {
    return this.db.all<T>(this.sql, this.values)
  }
}

function rowKey(apiKeyId: string, window: RateLimitWindow, windowStart: number): string {
  return `${apiKeyId}:${window}:${windowStart}`
}

function normalizeSql(sql: string): string {
  return sql.replace(/\s+/g, ' ').trim().toLowerCase()
}
