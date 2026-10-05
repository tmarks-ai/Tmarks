import { Hono } from 'hono'
import { afterEach, describe, expect, it } from 'vitest'
import { deleteTabGroupHandler } from '../src/routes/tab-groups/group-id'
import { permanentDeleteTabGroupHandler } from '../src/routes/tab-groups/group-lifecycle'
import { createSqliteD1, type SqliteD1Harness } from './helpers/sqlite-d1'
import type { AppEnv } from '../src/lib/env'

/**
 * R8 BR-1 回归网:子树级联删除必须对**每一个后裔组**发 sync change + 提升
 * revision——此前只发根组,后裔在增量 pull 里最长 24h 不可见,扩展端编辑幽灵
 * 子组后重推可复活已删数据。镜像 folders/delete.ts 的全 id 变更。
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

function seedTree(h: SqliteD1Harness, deleted: boolean) {
  const now = new Date().toISOString()
  const stmt = h.sqlite.prepare(
    `INSERT INTO tab_groups (id, user_id, title, parent_id, is_deleted, deleted_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  )
  stmt.run('g-root', USER, 'root', null, deleted ? 1 : 0, deleted ? now : null, now, now)
  stmt.run('g-child', USER, 'child', 'g-root', deleted ? 1 : 0, deleted ? now : null, now, now)
  stmt.run('g-grand', USER, 'grand', 'g-child', deleted ? 1 : 0, deleted ? now : null, now, now)
  // 不在子树里的对照组:级联不得越界。
  stmt.run('g-other', USER, 'other', null, 0, null, now, now)
}

function mount(h: SqliteD1Harness, handler: unknown, method: 'delete' | 'post', path: string) {
  const app = new Hono<AppEnv>()
  app.on(method.toUpperCase(), path, async (c, next) => {
    c.set('auth', { user_id: USER, auth_type: 'jwt' })
    await next()
  }, handler as never)
  return (id: string) =>
    app.request(`/${id}`, { method: method.toUpperCase() }, { DB: h.db } as AppEnv['Bindings'])
}

function subtreeDeleteChanges(h: SqliteD1Harness): string[] {
  return h.sqlite
    .prepare(
      `SELECT entity_id FROM sync_changes WHERE user_id = ? AND entity_type = 'tab_group' AND operation = 'delete'
       ORDER BY entity_id`,
    )
    .all(USER)
    .map((row) => (row as { entity_id: string }).entity_id)
}

describe('tab-group subtree cascade delete emits changes for every descendant (R8 BR-1)', () => {
  it('soft-deleting a folder group emits a delete change per descendant', async () => {
    const h = db()
    seedTree(h, false)
    const call = mount(h, deleteTabGroupHandler, 'delete', '/:id')

    const response = await call('g-root')

    expect(response.status).toBe(204)
    expect(subtreeDeleteChanges(h)).toEqual(['g-child', 'g-grand', 'g-root'])
    // tab_group 的 revision 存在行内 revision 列(非 sync_entity_revisions 注册表)
    // ——每个后裔的 revision 都被提升,迟到的旧设备推送会撞 revision_mismatch
    // 而不是静默复活已删组。
    const revisions = h.sqlite
      .prepare(`SELECT id, revision FROM tab_groups WHERE user_id = ? AND is_deleted = 1 ORDER BY id`)
      .all(USER)
      .map((row) => (row as { id: string; revision: string }).revision)
    expect(revisions).toHaveLength(3)
    for (const revision of revisions) expect(revision).toMatch(/^rev_/)
    const survivor = h.sqlite.prepare(`SELECT is_deleted FROM tab_groups WHERE id = 'g-other'`).get()
    expect(survivor).toEqual({ is_deleted: 0 })
  })

  it('permanent-deleting a trashed subtree emits a delete change per descendant', async () => {
    const h = db()
    seedTree(h, true)
    const call = mount(h, permanentDeleteTabGroupHandler, 'post', '/:id')

    const response = await call('g-root')
    const body = await response.json() as { data?: { message?: string } }

    expect(response.status).toBe(200)
    expect(body.data?.message).toContain('permanently deleted')
    expect(subtreeDeleteChanges(h)).toEqual(['g-child', 'g-grand', 'g-root'])
    const remaining = h.sqlite
      .prepare(`SELECT id FROM tab_groups WHERE user_id = ? ORDER BY id`)
      .all(USER)
      .map((row) => (row as { id: string }).id)
    expect(remaining).toEqual(['g-other'])
  })
})
