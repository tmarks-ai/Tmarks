import type { RateLimitConfig, RateLimitWindow } from './rate-limiter-types'

/** D1 限流的纯窗口计算(无 DB 依赖):窗口时长、限额与窗口起点的推导。 */

export function getWindowMs(window: RateLimitWindow): number {
  if (window === 'minute') return 60_000
  if (window === 'hour') return 3_600_000
  return 86_400_000
}

export function getLimit(limits: RateLimitConfig, window: RateLimitWindow): number {
  if (window === 'minute') return limits.per_minute
  if (window === 'hour') return limits.per_hour
  return limits.per_day
}

export function getWindowStart(now: number, windowMs: number): number {
  return Math.floor(now / windowMs) * windowMs
}

export interface WindowSlot {
  window: RateLimitWindow
  windowStart: number
  limit: number
  reset: number
}

export function getWindowSlots(now: number, limits: RateLimitConfig): WindowSlot[] {
  return (['minute', 'hour', 'day'] as const).map((window) => {
    const windowMs = getWindowMs(window)
    const windowStart = getWindowStart(now, windowMs)
    return {
      window,
      windowStart,
      limit: getLimit(limits, window),
      reset: windowStart + windowMs,
    }
  })
}
