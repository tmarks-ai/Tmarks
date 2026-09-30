import { hasPermission } from '@tmarks/contracts'
import type { AuthContext } from '../env'
import { forbidden } from '../response'

/**
 * For API-key-authenticated requests, enforce the required permission set.
 * Returns null when allowed (or when the request is JWT-authenticated), or a
 * 403 Response when a required permission is missing.
 */
export function requireApiKeyPermissions(
  auth: AuthContext,
  requiredPermissions: readonly string[]
): Response | null {
  if (auth.auth_type !== 'api_key') {
    return null
  }

  const grantedPermissions = auth.api_key_permissions || []
  const missingPermissions = [...new Set(requiredPermissions)]
    .filter((permission) => !hasPermission(grantedPermissions, permission))

  if (missingPermissions.length === 0) {
    return null
  }

  return forbidden({
    code: 'INSUFFICIENT_PERMISSIONS',
    message: `Missing required permissions: ${missingPermissions.join(', ')}`,
    required: missingPermissions,
    available: grantedPermissions,
  })
}
