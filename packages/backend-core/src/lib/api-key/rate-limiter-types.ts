export type RateLimitWindow = 'minute' | 'hour' | 'day'

export interface RateLimitConfig {
  per_minute: number
  per_hour: number
  per_day: number
}

// Default limits: reasonable for normal use, low enough to deter abuse.
export const DEFAULT_LIMITS: RateLimitConfig = {
  per_minute: 60,
  per_hour: 1000,
  per_day: 10000,
}

export interface RateLimitResult {
  allowed: boolean
  window: RateLimitWindow
  limit: number
  remaining: number
  reset: number // unix ms
  retryAfter?: number // seconds
}
