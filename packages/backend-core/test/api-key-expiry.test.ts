import { afterEach, describe, expect, it } from 'vitest'
import { validateApiKey } from '../src/lib/api-key/validator'
import { hashApiKey } from '../src/lib/api-key/generator'
import { createSqliteD1, type SqliteD1Harness } from './helpers/sqlite-d1'

const USER = 'user-1'

let harness: SqliteD1Harness | null = null

function db(): SqliteD1Harness {
  harness = createSqliteD1(USER)
  return harness
}

afterEach(() => {
  harness?.close()
  harness = null
})

function rawKey(): string {
  return `tmk_live_${'a'.repeat(20)}`
}

async function seedKey(h: SqliteD1Harness, key: string, expiresAt: string | null): Promise<void> {
  h.sqlite
    .prepare(
      `INSERT INTO api_keys (id, user_id, key_hash, key_prefix, name, permissions, status, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, 'active', ?)`
    )
    .run('key-1', USER, await hashApiKey(key), key.slice(0, 13), 'test', '["bookmarks.read"]', expiresAt)
}

describe('api key expiry against the real schema', () => {
  // Regression: markAsExpired wrote status='expired', which the baseline CHECK
  // (status IN ('active','revoked')) rejects — the UPDATE threw on every
  // request with the expired key and the catch surfaced a misleading
  // 'Internal validation error' (plus one failed D1 write per attempt).
  it('rejects an expired key without writing an invalid status (or throwing)', async () => {
    const h = db()
    const key = rawKey()
    await seedKey(h, key, new Date(Date.now() - 60_000).toISOString())

    const result = await validateApiKey(key, h.db)
    expect(result.valid).toBe(false)
    expect(result.error).toBe('API Key has expired')

    // The status column is untouched: expires_at is the source of truth.
    const row = h.sqlite.prepare('SELECT status FROM api_keys WHERE id = ?').get('key-1') as {
      status: string
    }
    expect(row.status).toBe('active')
  })

  it('accepts the same key while expires_at is still in the future', async () => {
    const h = db()
    const key = rawKey()
    await seedKey(h, key, new Date(Date.now() + 60_000).toISOString())

    const result = await validateApiKey(key, h.db)
    expect(result.valid).toBe(true)
    expect(result.permissions).toEqual(['bookmarks.read'])
  })

  it('accepts a key with no expiry (null expires_at)', async () => {
    const h = db()
    const key = rawKey()
    await seedKey(h, key, null)

    const result = await validateApiKey(key, h.db)
    expect(result.valid).toBe(true)
  })
})
