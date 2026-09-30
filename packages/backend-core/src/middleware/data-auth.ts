import type { MiddlewareHandler } from 'hono'
import type { AppEnv } from '../lib/env'
import { extractJWT } from '../lib/auth'
import { requireAuth } from './auth'
import { requireApiKey, type ApiKeyAuthOptions } from './api-key-auth'

/**
 * Authentication for the shared data plane.
 *
 * The Web app authenticates with its independent login session (Bearer JWT),
 * while the browser extension authenticates with an X-API-Key. Both resolve
 * to the same single-user data owner, but their credentials and lifecycles
 * remain separate.
 */
export function requireDataAuth(
  requiredPermission: string | readonly string[],
  options: ApiKeyAuthOptions = {},
): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    if (extractJWT(c.req.raw)) {
      return requireAuth(c, next)
    }
    return requireApiKey(requiredPermission, options)(c, next)
  }
}
