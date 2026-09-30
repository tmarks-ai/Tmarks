import {
  getInvalidPermissions,
  normalizePermissions,
  PERMISSION_TEMPLATES,
} from '@tmarks/contracts'
import type { Env } from '../env'
import { generateApiKey } from './generator'

const DEFAULT_ACTIVE_API_KEY_LIMIT = 20

export function getUserApiKeyLimit(env: Env): number {
  const configured = Number(env.API_KEY_MAX_ACTIVE_PER_USER)
  if (!Number.isFinite(configured) || configured <= 0) {
    return DEFAULT_ACTIVE_API_KEY_LIMIT
  }
  return Math.min(Math.floor(configured), 100)
}

export type PermissionTemplate = keyof typeof PERMISSION_TEMPLATES

interface ResolvePermissionsInput {
  template?: PermissionTemplate
  permissions?: string[]
}

interface ResolvePermissionsResult {
  permissions: string[]
  error?: { code: string; message: string }
}

function resolvePermissions(input: ResolvePermissionsInput): ResolvePermissionsResult {
  if (input.template) {
    const template = PERMISSION_TEMPLATES[input.template]
    if (!template) {
      return { permissions: [], error: { code: 'INVALID_INPUT', message: 'Invalid permission template' } }
    }
    return { permissions: normalizePermissions(template.permissions) }
  }
  if (!Array.isArray(input.permissions)) {
    return { permissions: normalizePermissions(PERMISSION_TEMPLATES.BASIC.permissions) }
  }
  const invalid = getInvalidPermissions(input.permissions)
  if (invalid.length > 0) {
    return { permissions: [], error: { code: 'INVALID_INPUT', message: `Invalid permissions: ${invalid.join(', ')}` } }
  }
  return { permissions: normalizePermissions(input.permissions) }
}

interface ApiKeyRow {
  id: string
  key_prefix: string
  name: string
  description: string | null
  permissions: string
  status: string
  expires_at: string | null
  last_used_at: string | null
  last_used_ip: string | null
  created_at: string
  updated_at: string
}

function mapKey(row: ApiKeyRow) {
  return { ...row, permissions: JSON.parse(row.permissions) as string[] }
}

export async function listApiKeys(
  db: D1Database,
  userId: string,
  limit: number
): Promise<{ keys: ReturnType<typeof mapKey>[]; quota: { used: number; limit: number } }> {
  const { results } = await db
    .prepare(
      `SELECT id, key_prefix, name, description, permissions, status, expires_at, last_used_at, last_used_ip, created_at, updated_at
       FROM api_keys WHERE user_id = ? AND name != 'Web session' ORDER BY created_at DESC`
    )
    .bind(userId)
    .all<ApiKeyRow>()
  const quota = await db
    .prepare(`SELECT COUNT(*) as count FROM api_keys WHERE user_id = ? AND status = 'active'`)
    .bind(userId)
    .first<{ count: number }>()
  return { keys: (results || []).map(mapKey), quota: { used: quota?.count || 0, limit } }
}

export interface CreateApiKeyInput {
  name: string
  description?: string
  template?: PermissionTemplate
  permissions?: string[]
  expires_at?: string | null
}

type CreateApiKeyResult =
  | { ok: true; key: string; data: Record<string, unknown> }
  | { ok: false; error: { code: string; message: string; quota?: { used: number; limit: number } } }

function parseExpiresAt(value: string): Date | null {
  let date: Date
  if (value.match(/^\d+d$/)) {
    date = new Date()
    date.setDate(date.getDate() + parseInt(value.slice(0, -1), 10))
  } else {
    date = new Date(value)
  }
  return date > new Date() ? date : null
}

export async function createApiKey(
  db: D1Database,
  userId: string,
  input: CreateApiKeyInput,
  limit: number
): Promise<CreateApiKeyResult> {
  const quota = await db
    .prepare(`SELECT COUNT(*) as count FROM api_keys WHERE user_id = ? AND status = 'active'`)
    .bind(userId)
    .first<{ count: number }>()
  const used = quota?.count || 0
  if (used >= limit) {
    return { ok: false, error: { code: 'QUOTA_EXCEEDED', message: `Maximum ${limit} API keys allowed per user`, quota: { used, limit } } }
  }
  if (!input.name || !input.name.trim()) {
    return { ok: false, error: { code: 'INVALID_INPUT', message: 'Name is required' } }
  }
  const resolved = resolvePermissions({ template: input.template, permissions: input.permissions })
  if (resolved.error) return { ok: false, error: resolved.error }
  if (resolved.permissions.length === 0) {
    return { ok: false, error: { code: 'INVALID_INPUT', message: 'At least one permission is required' } }
  }
  let expiresAt: string | null = null
  if (input.expires_at) {
    const expiresDate = parseExpiresAt(input.expires_at)
    if (!expiresDate) return { ok: false, error: { code: 'INVALID_INPUT', message: 'Expiration date must be in the future' } }
    expiresAt = expiresDate.toISOString()
  }
  const { key, prefix, hash } = await generateApiKey('live')
  const keyId = crypto.randomUUID()
  const now = new Date().toISOString()
  await db
    .prepare(
      `INSERT INTO api_keys (id, user_id, key_hash, key_prefix, name, description, permissions, status, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?)`
    )
    .bind(keyId, userId, hash, prefix, input.name.trim(), input.description?.trim() || null, JSON.stringify(resolved.permissions), expiresAt)
    .run()
  return {
    ok: true,
    key,
    data: {
      id: keyId,
      key_prefix: prefix,
      name: input.name.trim(),
      description: input.description?.trim() || null,
      permissions: resolved.permissions,
      status: 'active',
      expires_at: expiresAt,
      last_used_at: null,
      last_used_ip: null,
      created_at: now,
      updated_at: now,
    },
  }
}

export async function getApiKeyDetail(db: D1Database, userId: string, keyId: string) {
  const row = await db
    .prepare(
      `SELECT id, key_prefix, name, description, permissions, status, expires_at, last_used_at, last_used_ip, created_at, updated_at
       FROM api_keys WHERE id = ? AND user_id = ?`
    )
    .bind(keyId, userId)
    .first<ApiKeyRow>()
  return row ? mapKey(row) : null
}

export interface UpdateApiKeyInput {
  name?: string
  description?: string
  template?: PermissionTemplate
  permissions?: string[]
  expires_at?: string | null
}

type UpdateApiKeyResult =
  | { ok: true; data: Record<string, unknown> }
  | { ok: false; error: { code: string; message: string } }
  | null

export async function updateApiKey(
  db: D1Database,
  userId: string,
  keyId: string,
  input: UpdateApiKeyInput
): Promise<UpdateApiKeyResult> {
  const existing = await db.prepare(`SELECT id FROM api_keys WHERE id = ? AND user_id = ?`).bind(keyId, userId).first()
  if (!existing) return null
  const updates: string[] = []
  const values: (string | number | null)[] = []
  if (input.name !== undefined) {
    if (!input.name.trim()) return { ok: false, error: { code: 'INVALID_INPUT', message: 'Name cannot be empty' } }
    updates.push('name = ?')
    values.push(input.name.trim())
  }
  if (input.description !== undefined) {
    updates.push('description = ?')
    values.push(input.description?.trim() || null)
  }
  if (input.template || input.permissions) {
    const resolved = resolvePermissions({ template: input.template, permissions: input.permissions })
    if (resolved.error) return { ok: false, error: resolved.error }
    if (resolved.permissions.length === 0) return { ok: false, error: { code: 'INVALID_INPUT', message: 'At least one permission is required' } }
    updates.push('permissions = ?')
    values.push(JSON.stringify(resolved.permissions))
  }
  if (input.expires_at !== undefined) {
    if (input.expires_at === null) {
      updates.push('expires_at = NULL')
    } else {
      const expiresDate = parseExpiresAt(input.expires_at)
      if (!expiresDate) return { ok: false, error: { code: 'INVALID_INPUT', message: 'Expiration date must be in the future' } }
      updates.push('expires_at = ?')
      values.push(expiresDate.toISOString())
    }
  }
  if (updates.length === 0) return { ok: false, error: { code: 'INVALID_INPUT', message: 'No valid fields to update' } }
  updates.push('updated_at = ?')
  values.push(new Date().toISOString(), keyId, userId)
  await db.prepare(`UPDATE api_keys SET ${updates.join(', ')} WHERE id = ? AND user_id = ?`).bind(...values).run()
  const row = await db
    .prepare(
      `SELECT id, key_prefix, name, description, permissions, status, expires_at, last_used_at, last_used_ip, created_at, updated_at
       FROM api_keys WHERE id = ? AND user_id = ?`
    )
    .bind(keyId, userId)
    .first<ApiKeyRow>()
  if (!row) return { ok: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to load updated API key' } }
  return { ok: true, data: mapKey(row) }
}

export async function revokeApiKey(db: D1Database, userId: string, keyId: string): Promise<boolean> {
  const existing = await db.prepare(`SELECT id FROM api_keys WHERE id = ? AND user_id = ?`).bind(keyId, userId).first()
  if (!existing) return false
  await db
    .prepare(`UPDATE api_keys SET status = 'revoked', updated_at = ? WHERE id = ? AND user_id = ?`)
    .bind(new Date().toISOString(), keyId, userId)
    .run()
  return true
}

export async function deleteApiKeyHard(db: D1Database, userId: string, keyId: string): Promise<boolean> {
  const existing = await db.prepare(`SELECT id FROM api_keys WHERE id = ? AND user_id = ?`).bind(keyId, userId).first()
  if (!existing) return false
  await db.batch([
    db.prepare('DELETE FROM api_key_logs WHERE api_key_id = ?').bind(keyId),
    db.prepare('DELETE FROM api_keys WHERE id = ? AND user_id = ?').bind(keyId, userId),
  ])
  return true
}
