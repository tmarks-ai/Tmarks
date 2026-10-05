import { describe, expect, it } from 'vitest'
import { getApiKeyStats } from '@tmarks/backend-core'
import { createSqliteD1 } from './helpers/sqlite-d1'

/**
 * R8 BT-6 + CA-11: the old version of this file mocked the DB with a class
 * that re-implemented the `WHERE api_key_id = ? AND user_id = ?` predicate in
 * TypeScript — the production SQL never executed, so weakening the predicate
 * (e.g. dropping user_id) stayed green. Now the stats query runs against real
 * SQLite (the logs ROUTE was removed as dead code with getApiKeyLogs).
 */
describe('API key usage statistics ownership (real SQLite)', () => {
  it('scopes statistics by owner: another user’s rows never leak into totals', async () => {
    const h = createSqliteD1('owner')
    try {
      // FK enforcement (R8 IN-1): api_key_logs references api_keys AND users —
      // seed both parent rows first; the harness seeds the owner only.
      h.sqlite
        .prepare(`INSERT INTO users (id, username, password_hash) VALUES ('other', 'other', 'x')`)
        .run()
      h.sqlite
        .prepare(
          `INSERT INTO api_keys (id, user_id, key_hash, key_prefix, name, permissions)
           VALUES ('key-1', 'owner', 'hash-1', 'tmk_live_x', 'test key', '["bookmarks.read"]')`,
        )
        .run()
      const insert = h.sqlite.prepare(
        `INSERT INTO api_key_logs (api_key_id, user_id, endpoint, method, status, ip, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      insert.run('key-1', 'owner', '/bookmarks', 'GET', 200, '203.0.113.10', '2026-08-03T02:00:00.000Z')
      insert.run('key-1', 'other', '/private', 'GET', 500, '203.0.113.20', '2026-08-03T03:00:00.000Z')
      insert.run('key-1', 'owner', '/tags', 'POST', 201, null, '2026-08-03T01:00:00.000Z')

      // 'other' 的行虽更晚,但归属过滤必须把它排除在 owner 的统计之外。
      await expect(getApiKeyStats('key-1', 'owner', h.db)).resolves.toMatchObject({
        total_requests: 2,
        last_used_at: '2026-08-03T02:00:00.000Z',
        last_used_ip: '203.0.113.10',
      })

      await expect(getApiKeyStats('key-1', 'missing-owner', h.db)).resolves.toEqual({
        total_requests: 0,
        last_used_at: null,
        last_used_ip: null,
      })
    } finally {
      h.close()
    }
  })
})
