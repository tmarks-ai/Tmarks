import { describe, expect, it } from 'vitest'
import {
  consumeApiKeyRateLimit,
  consumeAssetRateLimit,
  consumeUnauthenticatedRateLimit,
} from '../src/lib/api-key/rate-limit-binding'
import { createSqliteD1 } from './helpers/sqlite-d1'
import type { RateLimitConfig } from '@tmarks/backend-core'

/**
 * R8 BT-2 回归网:Workers 生产(wrangler.toml 配了三个原生 ratelimit binding)只
 * 走本路径,而全部测试此前只测 D1 回退——绑定选择、limit() 抛错回退、
 * `:global` 路由到 GLOBAL_RATE_LIMITER 都是零执行的盲区。
 */
type BindingBehavior = 'allow' | 'deny' | 'throw'

function fakeBinding(behavior: BindingBehavior, calls: string[] = []) {
  return {
    limit: async ({ key }: { key: string }) => {
      calls.push(key)
      if (behavior === 'throw') throw new Error('binding unavailable')
      return { success: behavior === 'allow' }
    },
  }
}

function rateRows(h: ReturnType<typeof createSqliteD1>): number {
  const row = h.sqlite.prepare('SELECT COUNT(*) AS n FROM api_key_rate_limits').get() as { n: number }
  return row.n
}

const LIMITS: RateLimitConfig = { per_minute: 60, per_hour: 1000, per_day: 10000 }

describe('native ratelimit binding path (R8 BT-2)', () => {
  it('API-key limiter: binding allow/deny decides without a single D1 write', async () => {
    const h = createSqliteD1('user-1')
    try {
      const allowed = await consumeApiKeyRateLimit(
        { DB: h.db, RATE_LIMITER: fakeBinding('allow') } as never,
        'key-live',
      )
      expect(allowed).toMatchObject({ allowed: true, window: 'minute' })

      const denied = await consumeApiKeyRateLimit(
        { DB: h.db, RATE_LIMITER: fakeBinding('deny') } as never,
        'key-live',
      )
      expect(denied).toMatchObject({ allowed: false, remaining: 0 })
      expect(rateRows(h)).toBe(0) // 绑定路径零 D1 写——这正是它存在的意义
    } finally {
      h.close()
    }
  })

  it('API-key limiter: a throwing binding falls back to the D1 limiter', async () => {
    const h = createSqliteD1('user-1')
    try {
      const result = await consumeApiKeyRateLimit(
        { DB: h.db, RATE_LIMITER: fakeBinding('throw') } as never,
        'key-fallback',
      )
      expect(result.allowed).toBe(true)
      expect(rateRows(h)).toBeGreaterThan(0) // 回退路径真的写了 D1
    } finally {
      h.close()
    }
  })

  it('unauthenticated limiter: `:global` keys route to GLOBAL_RATE_LIMITER, others to RATE_LIMITER', async () => {
    const h = createSqliteD1('user-1')
    try {
      const globalCalls: string[] = []
      const sharedCalls: string[] = []
      const env = {
        DB: h.db,
        RATE_LIMITER: fakeBinding('allow', sharedCalls),
        GLOBAL_RATE_LIMITER: fakeBinding('deny', globalCalls),
      } as never

      await consumeUnauthenticatedRateLimit(env, 'login:global', LIMITS)
      expect(globalCalls).toEqual(['login:global'])
      expect(sharedCalls).toEqual([])

      await consumeUnauthenticatedRateLimit(env, 'login:1.2.3.4', LIMITS)
      expect(sharedCalls).toEqual(['login:1.2.3.4'])
      expect(rateRows(h)).toBe(0)
    } finally {
      h.close()
    }
  })

  it('asset limiter: the dedicated ASSET_RATE_LIMITER decides without D1 writes', async () => {
    const h = createSqliteD1('user-1')
    try {
      const ipLimits: RateLimitConfig = { per_minute: 600, per_hour: 10000, per_day: 100000 }
      const calls: string[] = []
      const denied = await consumeAssetRateLimit(
        { DB: h.db, ASSET_RATE_LIMITER: fakeBinding('deny', calls) } as never,
        '5.6.7.8',
        ipLimits,
        ipLimits,
      )
      expect(denied).toMatchObject({ allowed: false })
      expect(calls).toEqual(['asset:5.6.7.8'])
      expect(rateRows(h)).toBe(0)
    } finally {
      h.close()
    }
  })
})
