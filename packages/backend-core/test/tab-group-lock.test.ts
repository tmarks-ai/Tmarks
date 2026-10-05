import { Hono } from 'hono'
import { afterEach, describe, expect, it } from 'vitest'
import { batchUpdateTabGroupsHandler } from '../src/routes/tab-groups/batch-update'
import { groupItemsBatchAddHandler } from '../src/routes/tab-groups/group-items-batch'
import { applyTabGroupOperation } from '../src/lib/sync/sync-tab-groups'
import { validateTabGroupItemPayload } from '../src/lib/sync/sync-tab-group-items'
import { createSqliteD1, type SqliteD1Harness } from './helpers/sqlite-d1'
import type { AppEnv } from '../src/lib/env'

/**
 * R8 BR-3/CA-2 回归网:锁定的组"拒绝一切变更(解锁除外)"是服务端承诺的不变量
 * ——此前 web 树拖拽重排(batch-update)、组内批量加条目、整个扩展 sync push 面
 * 三条路径全部绕过它。
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

function seedGroups(h: SqliteD1Harness) {
  const now = new Date().toISOString()
  const stmt = h.sqlite.prepare(
    `INSERT INTO tab_groups (id, user_id, title, is_locked, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`,
  )
  stmt.run('g-locked', USER, 'locked', 1, now, now)
  stmt.run('g-free', USER, 'free', 0, now, now)
  // 已软删的组:parent 校验不得接受已删组作为新父级(R8 BR-1 同根因)。
  stmt.run('g-trashed', USER, 'trashed', 0, now, now)
  h.sqlite
    .prepare(`UPDATE tab_groups SET is_deleted = 1, deleted_at = ? WHERE id = 'g-trashed'`)
    .run(now)
}

function mount(h: SqliteD1Harness, handler: unknown, path: string) {
  const app = new Hono<AppEnv>()
  app.post(path, async (c, next) => {
    c.set('auth', { user_id: USER, auth_type: 'jwt' })
    await next()
  }, handler as never)
  return (body: unknown) =>
    app.request(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }, { DB: h.db } as AppEnv['Bindings'])
}

async function errorCode(response: Response): Promise<string | undefined> {
  const body = await response.json() as { error?: { code?: string } }
  return body.error?.code
}

describe('tab-group lock invariant (R8 BR-3/CA-2)', () => {
  it('batch-update (web tree drag-reorder) rejects locked groups', async () => {
    const h = db()
    seedGroups(h)
    const call = mount(h, batchUpdateTabGroupsHandler, '/batch-update')

    const rejected = await call({ updates: [{ id: 'g-locked', position: 0 }] })
    expect(rejected.status).toBe(403)
    expect(await errorCode(rejected)).toBe('RESOURCE_LOCKED')
    const position = h.sqlite.prepare(`SELECT position FROM tab_groups WHERE id = 'g-locked'`).get()
    expect(position).toEqual({ position: 0 })

    const accepted = await call({ updates: [{ id: 'g-free', position: 3 }] })
    expect(accepted.status).toBe(200)
    const moved = h.sqlite.prepare(`SELECT position FROM tab_groups WHERE id = 'g-free'`).get()
    expect(moved).toEqual({ position: 3 })
  })

  it('batch-update refuses a soft-deleted group as the new parent', async () => {
    const h = db()
    seedGroups(h)
    const call = mount(h, batchUpdateTabGroupsHandler, '/batch-update')

    const response = await call({ updates: [{ id: 'g-free', position: 0, parent_id: 'g-trashed' }] })

    expect(response.status).toBe(400)
  })

  it('batch-adding items to a locked group is rejected', async () => {
    const h = db()
    seedGroups(h)
    const app = new Hono<AppEnv>()
    app.post('/:id/items/batch', async (c, next) => {
      c.set('auth', { user_id: USER, auth_type: 'jwt' })
      await next()
    }, groupItemsBatchAddHandler as never)
    const env = { DB: h.db } as AppEnv['Bindings']
    const post = (id: string) =>
      app.request(`/${id}/items/batch`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ items: [{ title: 'x', url: 'https://example.com/' }] }),
      }, env)

    const rejected = await post('g-locked')
    expect(rejected.status).toBe(403)
    expect(await errorCode(rejected)).toBe('RESOURCE_LOCKED')
    const itemCount = h.sqlite.prepare(`SELECT COUNT(*) AS n FROM tab_group_items WHERE group_id = 'g-locked'`).get()
    expect(itemCount).toEqual({ n: 0 })

    const accepted = await post('g-free')
    expect(accepted.status).toBe(200)
  })

  it('sync push face rejects upserts onto a locked group with terminal code + server state', async () => {
    const h = db()
    seedGroups(h)

    const result = await applyTabGroupOperation(
      h.db,
      USER,
      'g-locked',
      'rev-test',
      new Date().toISOString(),
      { title: 'hijacked' } as never,
      'upsert',
    )

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('RESOURCE_LOCKED')
    const title = h.sqlite.prepare(`SELECT title FROM tab_groups WHERE id = 'g-locked'`).get()
    expect(title).toEqual({ title: 'locked' })

    const freeResult = await applyTabGroupOperation(
      h.db,
      USER,
      'g-free',
      'rev-test',
      new Date().toISOString(),
      { title: 'renamed ok' } as never,
      'upsert',
    )
    expect(freeResult.ok).toBe(true)
  })

  it('item pushes into a locked group are rejected by payload validation', async () => {
    const h = db()
    seedGroups(h)

    const lockedReason = await validateTabGroupItemPayload(
      h.db,
      USER,
      { group_id: 'g-locked', title: 't', url: 'https://example.com/' } as never,
      'upsert',
    )
    expect(lockedReason).toBe('Tab group is locked.')

    const freeReason = await validateTabGroupItemPayload(
      h.db,
      USER,
      { group_id: 'g-free', title: 't', url: 'https://example.com/' } as never,
      'upsert',
    )
    expect(freeReason).toBeNull()
  })

  it('sync push face refuses a soft-deleted group as the new parent', async () => {
    const h = db()
    seedGroups(h)

    const result = await applyTabGroupOperation(
      h.db,
      USER,
      'g-free',
      'rev-test',
      new Date().toISOString(),
      { title: 'moved', parent_id: 'g-trashed' } as never,
      'upsert',
    )

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toContain('parent tab group was not found')
  })
})
