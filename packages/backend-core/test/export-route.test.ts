import { describe, expect, it } from 'vitest'
import { Hono } from 'hono'
import { generateJWT } from '@tmarks/backend-core'
import { exportRoutes } from '../src/routes/export'
import { createSqliteD1 } from './helpers/sqlite-d1'
import type { AppEnv } from '../src/lib/env'
import type { TMarksExportData } from '@tmarks/contracts'

/**
 * GET/POST / 端点级回归(此前只测 collectExportData 纯函数,路由本身零覆盖):
 * 全量导出形状与 meta 计数、scope 切分、include_deleted、鉴权门、格式
 * 白名单、每分钟限流(export 是整库内存组装,必须有 429 护栏)。
 * 真 SQLite + 迁移 schema + 真 requireAuth(种子一个活跃会话行)。
 */

const JWT_SECRET = 'export-route-test-secret'
const USER = 'export-user'
const SESSION = 'export-session'

interface Harness {
  env: AppEnv['Bindings']
  sqlite: ReturnType<typeof createSqliteD1>['sqlite']
  app: Hono<AppEnv>
  close(): void
}

function setupExportHarness(): Harness {
  const harness = createSqliteD1(USER)
  const sqlite = harness.sqlite
  const now = new Date().toISOString()

  // requireAuth 的会话检查:一条未吊销、未过期的 auth_tokens 行。
  sqlite
    .prepare(
      `INSERT INTO auth_tokens (user_id, refresh_token_hash, expires_at, revoked_at, session_id, created_at)
       VALUES (?, ?, ?, NULL, ?, ?)`
    )
    .run(USER, 'hash', new Date(Date.now() + 3_600_000).toISOString(), SESSION, now)

  sqlite
    .prepare('INSERT INTO bookmark_folders (id, user_id, name, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run('f1', USER, 'Dev', 0, now, now)
  for (const [id, url, deleted] of [
    ['b1', 'https://example.com/a', false],
    ['b2', 'https://example.com/b', false],
    ['b3', 'https://example.com/removed', true],
  ] as const) {
    sqlite
      .prepare('INSERT INTO bookmarks (id, user_id, folder_id, title, url, created_at, updated_at, deleted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(id, USER, 'f1', `Bookmark ${id}`, url, now, now, deleted ? now : null)
  }
  sqlite
    .prepare('INSERT INTO tags (id, user_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
    .run('t1', USER, 'work', now, now)
  sqlite
    .prepare('INSERT INTO bookmark_tags (bookmark_id, tag_id, user_id, created_at) VALUES (?, ?, ?, ?)')
    .run('b1', 't1', USER, now)
  sqlite
    .prepare('INSERT INTO tab_groups (id, user_id, title, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run('g1', USER, 'Session group', 0, now, now)
  for (const [id, url] of [
    ['i1', 'https://example.com/tab-1'],
    ['i2', 'https://example.com/tab-2'],
  ] as const) {
    sqlite
      .prepare(
        'INSERT INTO tab_group_items (id, group_id, title, url, position, created_at) VALUES (?, ?, ?, ?, ?, ?)'
      )
      .run(id, 'g1', `Tab ${id}`, url, id === 'i1' ? 0 : 1, now)
  }

  const env = { DB: harness.db, JWT_SECRET } as AppEnv['Bindings']
  const app = new Hono<AppEnv>()
  app.route('/', exportRoutes)

  return {
    env,
    sqlite,
    app,
    close: () => harness.close(),
  }
}

async function bearerToken(): Promise<string> {
  return generateJWT({ sub: USER, session_id: SESSION }, JWT_SECRET)
}

function call(h: Harness, path = '/', method = 'GET', body?: unknown, token?: string) {
  return h.app.request(path, {
    method,
    headers: {
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(token === undefined ? {} : token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  }, h.env)
}

describe('GET / (export stream)', () => {
  it('streams the full account with meta counts, tag names and group items', async () => {
    const h = setupExportHarness()
    try {
      const res = await call(h, '/?scope=all', 'GET', undefined, await bearerToken())
      expect(res.status).toBe(200)
      expect(res.headers.get('Content-Type')).toBe('application/json')
      expect(res.headers.get('Content-Disposition')).toMatch(/^attachment; filename="tmarks-export-/)
      expect(res.headers.get('Cache-Control')).toContain('no-store')

      const data = await res.json() as TMarksExportData
      expect(data.metadata.source).toBe('tmarks')
      expect(data.metadata.total_bookmarks).toBe(2) // soft-deleted b3 excluded by default
      expect(data.metadata.total_bookmark_folders).toBe(1)
      expect(data.metadata.total_tags).toBe(1)
      expect(data.metadata.total_tab_groups).toBe(1)
      const tagged = data.bookmarks.find((b) => b.id === 'b1')
      expect(tagged?.tags).toContain('work')
      expect(data.tab_groups[0]?.items.map((i) => i.url)).toEqual([
        'https://example.com/tab-1',
        'https://example.com/tab-2',
      ])
    } finally {
      h.close()
    }
  })

  it('excludes soft-deleted bookmarks unless include_deleted=true', async () => {
    const h = setupExportHarness()
    try {
      const token = await bearerToken()
      const live = await call(h, '/?scope=bookmarks', 'GET', undefined, token)
      const liveData = await live.json() as TMarksExportData
      expect(liveData.bookmarks.map((b) => b.id).sort()).toEqual(['b1', 'b2'])

      const withDeleted = await call(h, '/?scope=bookmarks&include_deleted=true', 'GET', undefined, token)
      const deletedData = await withDeleted.json() as TMarksExportData
      expect(deletedData.metadata.total_bookmarks).toBe(3)
    } finally {
      h.close()
    }
  })

  it('scope=tab_groups exports only the tab-group plane', async () => {
    const h = setupExportHarness()
    try {
      const res = await call(h, '/?scope=tab_groups', 'GET', undefined, await bearerToken())
      const data = await res.json() as TMarksExportData
      expect(data.bookmarks).toEqual([])
      expect(data.metadata.total_bookmarks).toBe(0)
      expect(data.metadata.total_tab_groups).toBe(1)
      expect(res.headers.get('Content-Disposition')).toMatch(/tmarks-tab-groups-export/)
    } finally {
      h.close()
    }
  })

  it('rejects non-json formats and unauthenticated calls', async () => {
    const h = setupExportHarness()
    try {
      const token = await bearerToken()
      expect((await call(h, '/?format=html', 'GET', undefined, token)).status).toBe(400)
      expect((await call(h, '/', 'GET', undefined, '')).status).toBe(401)
      expect((await call(h, '/', 'GET')).status).toBe(401)
    } finally {
      h.close()
    }
  })

  it('rate-limits the stream endpoint after three requests in the window', async () => {
    const h = setupExportHarness()
    try {
      const token = await bearerToken()
      const statuses: number[] = []
      for (let i = 0; i < 4; i++) {
        statuses.push((await call(h, '/?scope=tab_groups', 'GET', undefined, token)).status)
      }
      expect(statuses.slice(0, 3)).toEqual([200, 200, 200])
      expect(statuses[3]).toBe(429)
    } finally {
      h.close()
    }
  })
})

describe('POST / (export preview)', () => {
  it('returns seeded counts and a json filename without consuming the stream quota', async () => {
    const h = setupExportHarness()
    try {
      const res = await call(h, '/', 'POST', { format: 'json', scope: 'all' }, await bearerToken())
      expect(res.status).toBe(200)
      const body = await res.json() as { data: { stats: Record<string, number>; estimated_size: number; format: string; estimated_filename: string } }
      expect(body.data.stats).toMatchObject({
        total_bookmarks: 2,
        total_bookmark_folders: 1,
        total_tags: 1,
        total_tab_groups: 1,
      })
      expect(body.data.format).toBe('json')
      expect(body.data.estimated_filename).toMatch(/^tmarks-export-/)
    } finally {
      h.close()
    }
  })

  it('rejects non-json formats and unauthenticated calls', async () => {
    const h = setupExportHarness()
    try {
      const token = await bearerToken()
      expect((await call(h, '/', 'POST', { format: 'csv' }, token)).status).toBe(400)
      expect((await call(h, '/', 'POST', {}, '')).status).toBe(401)
    } finally {
      h.close()
    }
  })
})
