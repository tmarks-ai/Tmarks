import { hasPermission } from '@tmarks/contracts'
import type { Context, MiddlewareHandler, Next } from 'hono'
import { consumeApiKeyRateLimit } from '../lib/api-key/rate-limit-binding'
import { logApiKeyUsage } from '../lib/api-key/logger'
import { validateApiKey } from '../lib/api-key/validator'
import type { AppEnv } from '../lib/env'
import { getSafeWaitUntil } from '../lib/safe-wait-until'
import { forbidden, tooManyRequests, unauthorized } from '../lib/response'

export interface ApiKeyAuthOptions {
  missingPermissionMessage?: string
}

/**
 * API-key authentication for the browser extension data plane.
 * Web requests are handled by requireDataAuth, which keeps the Web login
 * session independent from extension API keys.
 */
export function requireApiKey(
  requiredPermission: string | readonly string[],
  options: ApiKeyAuthOptions = {},
): MiddlewareHandler<AppEnv> {
  const requiredPermissions = Array.isArray(requiredPermission) ? [...requiredPermission] : [requiredPermission]

  return async (c, next) => {
    try {
      const apiKey = c.req.header('X-API-Key')
      if (!apiKey) {
        return unauthorized({
          code: 'MISSING_API_KEY',
          message: 'Authentication required. Provide an X-API-Key header.',
        })
      }

      return await handleApiKeyAuth(c, next, apiKey, requiredPermissions, options.missingPermissionMessage)
    } catch (error) {
      console.error('API key middleware error:', error)
      return unauthorized({ code: 'AUTH_ERROR', message: 'Authentication failed' })
    }
  }
}

/** last_used_at 刷新节流:展示用途,5 分钟内不重复写。 */
const LAST_USED_THROTTLE_MS = 5 * 60_000

async function handleApiKeyAuth(
  c: Context<AppEnv>,
  next: Next,
  apiKey: string,
  requiredPermissions: string[],
  missingPermissionMessage: string | undefined,
): Promise<Response | void> {
  const validation = await validateApiKey(apiKey, c.env.DB)
  if (!validation.valid || !validation.data || !validation.permissions) {
    return unauthorized({ code: 'INVALID_API_KEY', message: validation.error || 'Invalid API Key' })
  }

  const { data: keyData, permissions } = validation
  const missing = requiredPermissions.filter((permission) => !hasPermission(permissions, permission))
  if (missing.length > 0) {
    return forbidden({
      code: 'INSUFFICIENT_PERMISSIONS',
      message: missingPermissionMessage || `Missing required permission: ${missing.join(', ')}`,
      required: missing,
      available: permissions,
    })
  }

  const rateLimitResult = await consumeApiKeyRateLimit(c.env, keyData.id)
  const rateLimitHeaders: Record<string, string> = {
    'X-RateLimit-Limit': String(rateLimitResult.limit),
    'X-RateLimit-Remaining': String(rateLimitResult.remaining),
    'X-RateLimit-Reset': String(Math.ceil(rateLimitResult.reset / 1000)),
  }
  if (!rateLimitResult.allowed) {
    return tooManyRequests(
      { code: 'RATE_LIMIT_EXCEEDED', message: 'Too many requests. Please try again later.' },
      { 'Retry-After': String(rateLimitResult.retryAfter || 0), ...rateLimitHeaders },
    )
  }

  const ip = c.req.header('CF-Connecting-IP') || c.req.header('X-Forwarded-For') || null
  c.set('auth', {
    user_id: keyData.user_id,
    auth_type: 'api_key',
    api_key_id: keyData.id,
    api_key_permissions: permissions,
  })

  // last_used_at exists to show "recently active" in the settings UI; the
  // validator already read it, so skip the UPDATE when it is fresh — every
  // extension request (pull every 5 min) no longer costs a written row.
  const waitUntil = getSafeWaitUntil(c)
  const lastUsedMs = keyData.last_used_at ? Date.parse(keyData.last_used_at) : 0
  if (Number.isNaN(lastUsedMs) || Date.now() - lastUsedMs > LAST_USED_THROTTLE_MS) {
    waitUntil(updateApiKeyLastUsed(c.env.DB, keyData.id, ip))
  }
  await next()

  const headers = new Headers(c.res.headers)
  for (const [key, value] of Object.entries(rateLimitHeaders)) headers.set(key, value)
  c.res = new Response(c.res.body, { status: c.res.status, statusText: c.res.statusText, headers })
  waitUntil(
    logApiKeyUsage(
      {
        api_key_id: keyData.id,
        user_id: keyData.user_id,
        endpoint: c.req.path,
        method: c.req.method,
        status: c.res.status,
        ip,
      },
      c.env.DB,
    ),
  )
}

async function updateApiKeyLastUsed(db: D1Database, keyId: string, ip: string | null): Promise<void> {
  try {
    await db
      .prepare(`UPDATE api_keys SET last_used_at = ?, last_used_ip = ? WHERE id = ?`)
      .bind(new Date().toISOString(), ip, keyId)
      .run()
  } catch (error) {
    console.error('Failed to update last_used:', error)
  }
}
