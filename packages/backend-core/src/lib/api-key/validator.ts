/**
 * API Key Validator
 */

import { hashApiKey } from './generator'

interface ApiKeyData {
  id: string
  user_id: string
  permissions: string
  status: 'active' | 'revoked' | 'expired'
  expires_at: string | null
  last_used_at: string | null
  last_used_ip: string | null
}

interface ValidationResult {
  valid: boolean
  error?: string
  data?: ApiKeyData
  permissions?: string[]
}

export async function validateApiKey(
  apiKey: string,
  db: D1Database
): Promise<ValidationResult> {
  if (!apiKey || !apiKey.startsWith('tmk_')) {
    return { valid: false, error: 'Invalid API Key format' }
  }

  try {
    const keyHash = await hashApiKey(apiKey)

    const keyData = await db
      .prepare(
        `SELECT id, user_id, permissions, status, expires_at, last_used_at, last_used_ip
         FROM api_keys
         WHERE key_hash = ?`
      )
      .bind(keyHash)
      .first<ApiKeyData>()

    if (!keyData) {
      return { valid: false, error: 'API Key not found' }
    }

    if (keyData.status === 'revoked') {
      return { valid: false, error: 'API Key has been revoked' }
    }

    // Read-side defensive branch only: the baseline schema's CHECK constrains
    // status to ('active','revoked'), so an 'expired' row can only come from a
    // pre-baseline database. Never write the value back (see below).
    if (keyData.status === 'expired') {
      return { valid: false, error: 'API Key has expired' }
    }

    if (keyData.expires_at) {
      const expiresAt = new Date(keyData.expires_at)
      if (expiresAt < new Date()) {
        // Reject without persisting a status change: `status = 'expired'`
        // violates the schema CHECK (status IN ('active','revoked')), so a
        // write here would throw on every request with the expired key —
        // burning a failed D1 write per attempt and surfacing a misleading
        // AUTH_ERROR instead of this message. expires_at is the source of
        // truth; the settings UI reads it to show the key as expired.
        return { valid: false, error: 'API Key has expired' }
      }
    }

    const permissions = JSON.parse(keyData.permissions) as string[]

    return {
      valid: true,
      data: keyData,
      permissions,
    }
  } catch (error) {
    console.error('API Key validation error:', error)
    return { valid: false, error: 'Internal validation error' }
  }
}
