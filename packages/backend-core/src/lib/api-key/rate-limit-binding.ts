import type { Env } from '../env'
import { consumeRateLimit } from './rate-limiter'
import { DEFAULT_LIMITS } from './rate-limiter-types'
import type { RateLimitConfig, RateLimitResult } from './rate-limiter-types'
/**
 * Unified API-key rate limiter.
 *
 * Prefers the Cloudflare native Rate Limiting binding (env.RATE_LIMITER); when it
 * is absent or errors, falls back to the D1-backed limiter. Native binding only
 * reports a success boolean, so the returned limit/remaining are advisory header
 * values derived from DEFAULT_LIMITS (the authoritative limit/period is the
 * binding configuration in wrangler.toml).
 */
export async function consumeApiKeyRateLimit(env: Env, apiKeyId: string): Promise<RateLimitResult> {
  if (env.RATE_LIMITER) {
    try {
      const { success } = await env.RATE_LIMITER.limit({ key: apiKeyId })
      const limit = DEFAULT_LIMITS.per_minute
      return {
        allowed: success,
        window: 'minute',
        limit,
        remaining: success ? limit - 1 : 0,
        reset: Date.now() + 60_000,
      }
    } catch {
      // Native binding errored — fall back to the D1 limiter below.
    }
  }
  return consumeRateLimit(apiKeyId, env.DB, DEFAULT_LIMITS, { windows: 'minute' })
}

/**
 * Rate limiting for UNAUTHENTICATED endpoints (login, register, refresh,
 * public share). These face the open internet: sustained hostile probing at
 * ~40k/day would write 200k+ rate-limit rows and blow the D1 free tier's
 * 100k rows/day by itself. With the native Rate Limiting binding configured
 * (wrangler.toml RATE_LIMITER), the decision costs zero D1 I/O — the binding's
 * single configured rate governs every key (documented in DEPLOY.md); without
 * it the D1 fallback consumes a single minute window (1 row written, not 3).
 * Fail-closed on either path.
 *
 * `*:global` buckets route through the dedicated GLOBAL_RATE_LIMITER binding
 * (600/min) when present: the shared binding's single 60/min rate would clamp
 * login:global (intended 120/min) and share:global (intended 600/min) into a
 * deployment-wide lockout that a single pacing attacker IP can hold open,
 * 429-ing every legitimate visitor.
 */
export async function consumeUnauthenticatedRateLimit(
  env: Pick<Env, 'DB' | 'RATE_LIMITER' | 'GLOBAL_RATE_LIMITER'>,
  key: string,
  limits: RateLimitConfig
): Promise<RateLimitResult> {
  const binding = key.endsWith(':global') ? (env.GLOBAL_RATE_LIMITER ?? env.RATE_LIMITER) : env.RATE_LIMITER
  if (binding) {
    try {
      const { success } = await binding.limit({ key })
      return {
        allowed: success,
        window: 'minute',
        limit: limits.per_minute,
        remaining: success ? Math.max(0, limits.per_minute - 1) : 0,
        reset: Date.now() + 60_000,
      }
    } catch {
      // Native binding errored — fall back to the D1 limiter below.
    }
  }
  return consumeRateLimit(key, env.DB, limits, { onError: 'deny', windows: 'minute' })
}

/**
 * Rate limiting for public asset reads (favicons/cover images).
 *
 * A DEDICATED binding is required rather than reusing RATE_LIMITER: the shared
 * binding's single configured rate (60/min, tuned for auth endpoints) is far
 * below a legitimate cold-cache page burst (up to 200 images on one grid), so
 * routing assets through it would 429 every card on the deployment. The asset
 * binding is configured at 600/min per IP. Without it (self-host / local dev),
 * the D1 dual bucket applies: per-IP then global, minute window, fail-closed.
 */
export async function consumeAssetRateLimit(
  env: Pick<Env, 'DB' | 'ASSET_RATE_LIMITER'>,
  clientIP: string,
  ipLimits: RateLimitConfig,
  globalLimits: RateLimitConfig
): Promise<RateLimitResult> {
  if (env.ASSET_RATE_LIMITER) {
    try {
      const { success } = await env.ASSET_RATE_LIMITER.limit({ key: `asset:${clientIP}` })
      return {
        allowed: success,
        window: 'minute',
        limit: ipLimits.per_minute,
        remaining: success ? Math.max(0, ipLimits.per_minute - 1) : 0,
        reset: Date.now() + 60_000,
      }
    } catch {
      // Native binding errored — fall back to the D1 limiter below.
    }
  }
  const perIp = await consumeRateLimit(`asset:${clientIP}`, env.DB, ipLimits, { onError: 'deny', windows: 'minute' })
  if (!perIp.allowed) return perIp
  return consumeRateLimit('asset:global', env.DB, globalLimits, { onError: 'deny', windows: 'minute' })
}
