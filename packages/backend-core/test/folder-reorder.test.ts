import { Hono } from 'hono'
import { afterEach, describe, expect, it } from 'vitest'
import { reorderFoldersHandler } from '../src/routes/folders/reorder'
import { createSqliteD1, type SqliteD1Harness } from './helpers/sqlite-d1'
import type { AppEnv } from '../src/lib/env'

/**
 * R5-13 regression: folder reordering previously fired one PATCH per sibling
 * from the web panel; the batch endpoint collapses a whole sibling order into
 * one request. The existence read must chunk against D1's 100-bound-parameter
 * cap (the harness enforces it live).
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
  app.post('/reorder', async (c, next) => {
    c.set('auth', { user_id: USER, auth_type: 'jwt' })
    await next()
  }, reorderFoldersHandler as never)
  return (body: unknown) =>
    app.request('/reorder', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }, { DB: h.db } as AppEnv['Bindings'])
}

function seedFolders(h: SqliteD1Harness, count: number) {
  const stmt = h.sqlite.prepare(
    `INSERT INTO bookmark_folders (id, user_id, name, parent_id, position, created_at, updated_at)
     VALUES (?, ?, ?, NULL, ?, ?, ?)`,
  )
  for (let i = 0; i < count; i++) {
    stmt.run(`f-${i}`, USER, `folder-${i}`, i, new Date().toISOString(), new Date().toISOString())
  }
}

describe('folder batch reorder (R5-13)', () => {
  it('applies the full sibling order in one atomic batch and emits one sync change per folder', async () => {
    const h = db()
    seedFolders(h, 3)
    const call = mount(h)

    const res = await call({ updates: [
      { id: 'f-2', position: 0 },
      { id: 'f-0', position: 1 },
      { id: 'f-1', position: 2 },
    ] })
    expect(res.status).toBe(200)

    const positions = (h.sqlite
      .prepare('SELECT id, position FROM bookmark_folders ORDER BY position')
      .all() as Array<{ id: string; position: number }>)
    expect(positions.map((row) => row.id)).toEqual(['f-2', 'f-0', 'f-1'])
    const changes = h.sqlite
      .prepare(`SELECT COUNT(*) AS n FROM sync_changes WHERE entity_type = 'bookmark_folder' AND operation = 'upsert'`)
      .get() as { n: number }
    expect(changes.n).toBe(3)
  })

  it('rejects unknown or foreign folder ids without writing anything', async () => {
    const h = db()
    seedFolders(h, 2)
    const call = mount(h)

    const res = await call({ updates: [
      { id: 'f-0', position: 5 },
      { id: 'not-a-folder', position: 6 },
    ] })
    expect(res.status).toBe(400)
    expect(h.sqlite.prepare('SELECT COUNT(*) AS n FROM sync_changes').get()).toEqual({ n: 0 })
  })

  it('rejects more than 200 updates and malformed items', async () => {
    const h = db()
    seedFolders(h, 5)
    const call = mount(h)

    const tooMany = await call({ updates: Array.from({ length: 201 }, (_, i) => ({ id: `f-${i % 5}`, position: i })) })
    expect(tooMany.status).toBe(400)

    const malformed = await call({ updates: [{ id: 'f-0', position: 'zero' }] })
    expect(malformed.status).toBe(400)
  })

  it('handles 150 updates in one request (chunked existence read, D1 100-param cap)', async () => {
    const h = db()
    seedFolders(h, 150)
    const call = mount(h)

    const res = await call({
      updates: Array.from({ length: 150 }, (_, i) => ({ id: `f-${i}`, position: 149 - i })),
    })
    expect(res.status).toBe(200)
    const first = h.sqlite.prepare('SELECT id FROM bookmark_folders WHERE position = 0').get() as { id: string }
    expect(first.id).toBe('f-149')
  })
})
