import { Hono } from 'hono'
import { afterEach, describe, expect, it } from 'vitest'
import { listBookmarksHandler } from '../src/routes/bookmarks/list'
import { createSqliteD1, type SqliteD1Harness } from './helpers/sqlite-d1'
import type { AppEnv } from '../src/lib/env'

/**
 * R8 BT-4 回归网:GET /bookmarks 的 handler 此前零执行覆盖——分页测试复刻了
 * handler 的循环(handler 内漂移时测试照绿),related_tag_ids 的四表 JOIN 从未
 * 跑过真 SQL。本套件把真 handler 挂到真 SQLite 上。
 */
const USER = 'user-1'

let harness: SqliteD1Harness | null = null
afterEach(() => {
  harness?.close()
  harness = null
})

function db(): SqliteD1Harness {
  harness = createSqliteD1(USER)
  return harness
}

function mount(h: SqliteD1Harness) {
  const app = new Hono<AppEnv>()
  app.get('/bookmarks', async (c, next) => {
    c.set('auth', { user_id: USER, auth_type: 'jwt' })
    await next()
  }, listBookmarksHandler as never)
  return (query: string) =>
    app.request(`/bookmarks${query}`, {}, { DB: h.db } as AppEnv['Bindings'])
}

function seedWorkspace(h: SqliteD1Harness) {
  const now = new Date().toISOString()
  h.sqlite.prepare(`INSERT INTO bookmark_folders (id, user_id, name) VALUES ('f-1', ?, 'work')`).run(USER)
  h.sqlite.prepare(`INSERT INTO tags (id, user_id, name) VALUES ('t-ai', ?, 'ai')`).run(USER)
  h.sqlite.prepare(`INSERT INTO tags (id, user_id, name) VALUES ('t-web', ?, 'web')`).run(USER)
  const bookmark = h.sqlite.prepare(
    `INSERT INTO bookmarks (id, user_id, title, url, folder_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
  )
  bookmark.run('bm-1', USER, 'First', 'https://example.com/1', 'f-1', now, now)
  bookmark.run('bm-2', USER, 'Second', 'https://example.com/2', null, now, now)
  const link = h.sqlite.prepare(
    `INSERT INTO bookmark_tags (bookmark_id, tag_id, user_id, created_at) VALUES (?, ?, ?, ?)`,
  )
  // bm-1 带 ai+web;bm-2 只带 ai——与 ai 共现的 related tag 因此是 web。
  link.run('bm-1', 't-ai', USER, now)
  link.run('bm-1', 't-web', USER, now)
  link.run('bm-2', 't-ai', USER, now)
}

interface ListEnvelope {
  data?: {
    bookmarks?: Array<{ id: string; tags: Array<{ id: string }>; folder_path: string[] }>
    meta?: { count?: number; has_more?: boolean; next_cursor?: string | null; related_tag_ids?: string[] }
  }
}

describe('GET /bookmarks handler against real SQLite (R8 BT-4)', () => {
  it('paginates with a real follow-up request and computes related tags via real SQL', async () => {
    const h = db()
    seedWorkspace(h)
    const call = mount(h)

    const first = await call('?page_size=1&sort=created')
    const firstBody = await first.json() as ListEnvelope

    expect(first.status).toBe(200)
    // sort=created 的未置顶臂按 created_at DESC, id DESC——同时间戳下 id 大者在前。
    expect(firstBody.data?.bookmarks).toHaveLength(1)
    expect(firstBody.data?.bookmarks?.[0]?.id).toBe('bm-2')
    expect(firstBody.data?.meta?.has_more).toBe(true)
    expect(firstBody.data?.meta?.next_cursor).toBeTruthy()

    // 用 handler 真实签发的游标翻第二页——不再复刻循环。
    const cursor = encodeURIComponent(firstBody.data!.meta!.next_cursor!)
    const second = await call(`?page_size=1&sort=created&page_cursor=${cursor}`)
    const secondBody = await second.json() as ListEnvelope
    expect(secondBody.data?.bookmarks?.[0]?.id).toBe('bm-1')
    // 两个 tag 都在 payload 上(真 SQL 的 fetchBookmarkTags 路径),目录路径来自 folder_path 映射。
    expect(secondBody.data?.bookmarks?.[0]?.tags.map((tag) => tag.id).sort()).toEqual(['t-ai', 't-web'])
    expect(secondBody.data?.bookmarks?.[0]?.folder_path).toEqual(['work'])
    expect(secondBody.data?.meta?.has_more).toBe(false)
  })

  it('filters by tag and returns the co-occurring related_tag_ids from real SQL', async () => {
    const h = db()
    seedWorkspace(h)
    const call = mount(h)

    const response = await call('?tags=t-ai')
    const body = await response.json() as ListEnvelope

    expect(body.data?.bookmarks).toHaveLength(2)
    expect(body.data?.meta?.related_tag_ids).toContain('t-web')
    expect(body.data?.meta?.related_tag_ids).not.toContain('t-ai')
  })
})
