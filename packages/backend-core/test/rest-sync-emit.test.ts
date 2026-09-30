import { Hono } from 'hono'
import { afterEach, describe, expect, it } from 'vitest'
import type { AppEnv } from '../src/lib/env'
import { updatePreferencesHandler } from '../src/routes/preferences'
import { batchUpdateTabGroupsHandler } from '../src/routes/tab-groups/batch-update'
import { itemsBatchHandler } from '../src/routes/tab-groups/items-batch'
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

/** Mount a handler behind an auth-stub middleware, mirroring audit-http-surface. */
function mount(h: SqliteD1Harness, method: 'patch' | 'post', path: string, handler: (c: never) => Promise<Response>) {
  const app = new Hono<AppEnv>()
  app[method](
    path,
    async (c, next) => {
      c.set('auth', { user_id: USER, auth_type: 'jwt' })
      await next()
    },
    handler as never
  )
  return (body: unknown) =>
    app.request(path, { method: method.toUpperCase(), body: JSON.stringify(body) }, { DB: h.db } as AppEnv['Bindings'])
}

function syncChanges(h: SqliteD1Harness, entityType: string): number {
  return (
    h.sqlite
      .prepare('SELECT COUNT(*) AS n FROM sync_changes WHERE entity_type = ?')
      .get(entityType) as { n: number }
  ).n
}

function seedGroup(h: SqliteD1Harness, id: string): void {
  const now = new Date().toISOString()
  h.sqlite
    .prepare('INSERT INTO tab_groups (id, user_id, title, is_folder, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?)')
    .run(id, USER, `group ${id}`, now, now)
  h.sqlite
    .prepare('INSERT INTO tab_group_items (id, group_id, title, url, position) VALUES (?, ?, ?, ?, ?)')
    .run(`${id}-item-1`, id, 'item', 'https://example.com/item', 0)
  h.sqlite
    .prepare('INSERT INTO tab_group_items (id, group_id, title, url, position) VALUES (?, ?, ?, ?, ?)')
    .run(`${id}-item-2`, id, 'item2', 'https://example.com/item2', 1)
}

// Regression (audit N-2): these three REST write paths applied their mutation
// but never emitted a sync change, so the extension's incremental pull stayed
// blind to them until the next (24h) bootstrap.
describe('REST write paths emit sync changes', () => {
  it('PATCH /preferences records a preference change', async () => {
    const h = db()
    h.sqlite
      .prepare('INSERT INTO user_preferences (user_id) VALUES (?)')
      .run(USER)
    const call = mount(h, 'patch', '/preferences', updatePreferencesHandler)

    const res = await call({ theme: 'dark' })
    expect(res.status).toBe(200)
    expect(syncChanges(h, 'preference')).toBe(1)
  })

  it('PATCH /tab-groups/batch-update records a change per affected group', async () => {
    const h = db()
    seedGroup(h, 'group-a')
    seedGroup(h, 'group-b')
    const call = mount(h, 'patch', '/tab-groups/batch-update', batchUpdateTabGroupsHandler)

    const res = await call({
      updates: [
        { id: 'group-a', position: 1 },
        { id: 'group-b', position: 0 },
      ],
    })
    expect(res.status).toBe(200)
    expect(syncChanges(h, 'tab_group')).toBe(2)
  })

  it('POST /tab-groups/items/batch records a change for the owning group', async () => {
    const h = db()
    seedGroup(h, 'group-a')
    const call = mount(h, 'post', '/tab-groups/items/batch', itemsBatchHandler)

    const res = await call({ action: 'delete', item_ids: ['group-a-item-1', 'group-a-item-2'] })
    expect(res.status).toBe(200)
    expect(syncChanges(h, 'tab_group')).toBe(1)
    // The deletion itself landed.
    const items = h.sqlite
      .prepare('SELECT COUNT(*) AS n FROM tab_group_items WHERE group_id = ?')
      .get('group-a') as { n: number }
    expect(items.n).toBe(0)
  })
})
