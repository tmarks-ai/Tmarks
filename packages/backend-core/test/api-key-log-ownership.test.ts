import { describe, expect, it } from 'vitest'
import { getApiKeyLogs, getApiKeyStats } from '@tmarks/backend-core'

type ApiLog = {
  api_key_id: string
  user_id: string
  endpoint: string
  method: string
  status: number
  ip: string | null
  created_at: string
}

class ApiKeyLogDb {
  constructor(private readonly rows: ApiLog[]) {}

  prepare(sql: string) {
    return new ApiKeyLogStatement(this, sql)
  }

  select(sql: string, values: unknown[]) {
    const normalized = sql.replace(/\s+/g, ' ').trim().toLowerCase()
    const apiKeyId = String(values[0])
    const userId = String(values[1])
    const scoped = this.rows
      .filter((row) => row.api_key_id === apiKeyId && row.user_id === userId)
      .sort((left, right) => right.created_at.localeCompare(left.created_at))

    if (normalized.includes('count(*)')) {
      return {
        total_requests: scoped.length,
        last_used_at: scoped[0]?.created_at ?? null,
        last_used_ip: scoped[0]?.ip ?? null,
      }
    }

    return { results: scoped.slice(0, Number(values[2])) }
  }
}

class ApiKeyLogStatement {
  private values: unknown[] = []

  constructor(
    private readonly db: ApiKeyLogDb,
    private readonly sql: string,
  ) {}

  bind(...values: unknown[]) {
    this.values = values
    return this
  }

  async all<T>() {
    return this.db.select(this.sql, this.values) as T
  }

  async first<T>() {
    return this.db.select(this.sql, this.values) as T
  }
}

describe('API key log ownership', () => {
  const rows: ApiLog[] = [
    { api_key_id: 'key-1', user_id: 'owner', endpoint: '/bookmarks', method: 'GET', status: 200, ip: '203.0.113.10', created_at: '2026-08-03T02:00:00.000Z' },
    { api_key_id: 'key-1', user_id: 'other', endpoint: '/private', method: 'GET', status: 500, ip: '203.0.113.20', created_at: '2026-08-03T03:00:00.000Z' },
    { api_key_id: 'key-1', user_id: 'owner', endpoint: '/tags', method: 'POST', status: 201, ip: null, created_at: '2026-08-03T01:00:00.000Z' },
  ]

  it('scopes logs by owner and applies the requested limit', async () => {
    const logs = await getApiKeyLogs('key-1', 'owner', new ApiKeyLogDb(rows) as unknown as D1Database, 1)
    expect(logs).toHaveLength(1)
    expect(logs[0]).toMatchObject({ endpoint: '/bookmarks', user_id: 'owner' })
  })

  it('scopes statistics by owner and returns zero values for an owner with no logs', async () => {
    const db = new ApiKeyLogDb(rows) as unknown as D1Database
    await expect(getApiKeyStats('key-1', 'owner', db)).resolves.toMatchObject({
      total_requests: 2,
      last_used_at: '2026-08-03T02:00:00.000Z',
      last_used_ip: '203.0.113.10',
    })
    await expect(getApiKeyStats('key-1', 'missing-owner', db)).resolves.toEqual({
      total_requests: 0,
      last_used_at: null,
      last_used_ip: null,
    })
  })
})
