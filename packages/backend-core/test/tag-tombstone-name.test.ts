import { Hono } from 'hono'
import { afterEach, describe, expect, it } from 'vitest'
import type { AppEnv } from '../src/lib/env'
import { createTagHandler } from '../src/routes/tags/create'
import { updateTagHandler } from '../src/routes/tags/update'
import { resolveOrCreateTagIds } from '../src/lib/tags'
import { createSqliteD1, type SqliteD1Harness } from './helpers/sqlite-d1'

/**
 * Tombstoned tag names are parked by UNIQUE(user_id, name) — every REST path
 * that matches names live-only and INSERTs a "new" tag dies on that
 * constraint as a 500. These tests pin the unified semantics: explicit
 * creates (POST /tags, bookmark-save name resolution) resurrect the tombstone
 * like the sync plane does, while renames onto a tombstoned name reject with
 * a clean 409 like applyTagOperation does.
 */

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

/** Mount a handler behind an auth-stub middleware, mirroring rest-sync-emit. */
function mount(h: SqliteD1Harness, method: 'patch' | 'post', mountPath: string, handler: (c: never) => Promise<Response>) {
  const app = new Hono<AppEnv>()
  app[method](
    mountPath,
    async (c, next) => {
      c.set('auth', { user_id: USER, auth_type: 'jwt' })
      await next()
    },
    handler as never
  )
  return (requestPath: string, body: unknown) =>
    app.request(requestPath, { method: method.toUpperCase(), body: JSON.stringify(body) }, { DB: h.db } as AppEnv['Bindings'])
}

const NOW = new Date().toISOString()

function seedTag(h: SqliteD1Harness, id: string, name: string, tombstoned: boolean): void {
  h.sqlite
    .prepare('INSERT INTO tags (id, user_id, name, created_at, updated_at, deleted_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(id, USER, name, NOW, NOW, tombstoned ? NOW : null)
}

function tagRow(h: SqliteD1Harness, id: string): { id: string; name: string; deleted_at: string | null; bookmark_count: number } {
  return h.sqlite
    .prepare('SELECT id, name, deleted_at, bookmark_count FROM tags WHERE id = ?')
    .get(id) as { id: string; name: string; deleted_at: string | null; bookmark_count: number }
}

describe('tombstoned tag names across REST paths', () => {
  it('POST /tags resurrects the tombstone row instead of dying on the name UNIQUE', async () => {
    const h = db()
    seedTag(h, 'tag-dead', 'linux', true)
    // A live link survived the tombstone (sync-plane delete keeps links) and
    // the bookmark was trashed during the window: the frozen counter is stale.
    h.sqlite
      .prepare('INSERT INTO bookmarks (id, user_id, title, url, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run('bm-1', USER, 't', 'https://example.com/1', NOW, NOW)
    h.sqlite
      .prepare('INSERT INTO bookmark_tags (bookmark_id, tag_id, user_id, created_at) VALUES (?, ?, ?, ?)')
      .run('bm-1', 'tag-dead', USER, NOW)
    h.sqlite
      .prepare("UPDATE bookmarks SET deleted_at = ?, updated_at = ? WHERE id = ?")
      .run(NOW, NOW, 'bm-1')
    expect(tagRow(h, 'tag-dead').bookmark_count).toBe(0) // link never counted (tag was trashed)

    const call = mount(h, 'post', '/tags', createTagHandler)
    const res = await call('/tags', { name: 'linux', color: '#ff0000' })
    expect(res.status).toBe(201)

    // Same row, resurrected, with the maintained counter recomputed by the
    // tag_trash_to_live trigger (the surviving link's bookmark is trashed).
    const rows = h.sqlite.prepare('SELECT id FROM tags WHERE user_id = ?').all(USER) as Array<{ id: string }>
    expect(rows).toEqual([{ id: 'tag-dead' }])
    const tag = tagRow(h, 'tag-dead')
    expect(tag.deleted_at).toBeNull()
    expect(tag.bookmark_count).toBe(0)

    // The extension must see the resurrection on incremental pull.
    const change = h.sqlite
      .prepare("SELECT COUNT(*) AS n FROM sync_changes WHERE entity_type = 'tag' AND entity_id = ? AND operation = 'upsert'")
      .get('tag-dead') as { n: number }
    expect(change.n).toBe(1)
  })

  it('POST /tags still answers 409 for a live name', async () => {
    const h = db()
    seedTag(h, 'tag-live', 'linux', false)
    const call = mount(h, 'post', '/tags', createTagHandler)
    const res = await call('/tags', { name: 'linux' })
    expect(res.status).toBe(409)
  })

  it('PATCH /tags/:id rejects renaming onto a tombstoned name with 409, not 500', async () => {
    const h = db()
    seedTag(h, 'tag-live', 'rust', false)
    seedTag(h, 'tag-dead', 'linux', true)
    const call = mount(h, 'patch', '/tags/:id', updateTagHandler)
    const res = await call('/tags/tag-live', { name: 'linux' })
    expect(res.status).toBe(409)
    const body = await res.json() as { error: { code?: string } }
    expect(body.error.code).toBe('TAG_EXISTS')
    // The live tag kept its name.
    expect(tagRow(h, 'tag-live').name).toBe('rust')
  })

  it('resolveOrCreateTagIds reuses and resurrects a tombstoned name case-insensitively', async () => {
    const h = db()
    seedTag(h, 'tag-dead', 'Linux', true)
    seedTag(h, 'tag-live', 'rust', false)

    // Sequential on purpose: the local sqlite harness serializes batches with
    // BEGIN/COMMIT and cannot nest concurrent db.batch() calls.
    const reused = await resolveOrCreateTagIds(h.db, USER, ['RUST'])
    const resurrected = await resolveOrCreateTagIds(h.db, USER, ['linux'])
    const fresh = await resolveOrCreateTagIds(h.db, USER, ['devops'])
    expect(reused).toEqual(['tag-live'])
    expect(resurrected).toEqual(['tag-dead'])
    expect(tagRow(h, 'tag-dead').deleted_at).toBeNull()
    expect(fresh).toHaveLength(1)
    // One row per name: the tombstone was reused (original casing kept), the
    // live tag reused, devops created — no UNIQUE crash, no near-duplicates.
    const all = h.sqlite.prepare('SELECT name FROM tags WHERE user_id = ? ORDER BY name').all(USER) as Array<{ name: string }>
    expect(all.map((row) => row.name)).toEqual(['Linux', 'devops', 'rust'])
  })
})
