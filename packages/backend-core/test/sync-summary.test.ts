import { describe, expect, it } from 'vitest'
import { Hono } from 'hono'
import type { AppEnv, Env } from '../src/lib/env'
import { syncSummaryHandler } from '../src/routes/sync/summary'
import { asD1, seedBookmark, SyncMemoryD1Database } from './helpers/sync-d1-harness'

const userId = 'single-user'

function buildApp(db: SyncMemoryD1Database) {
  const app = new Hono<AppEnv>()
  // Bypass auth middleware; the harness data plane is single-user.
  app.use('*', async (c, next) => {
    c.set('auth', { user_id: userId, auth_type: 'jwt' })
    await next()
  })
  app.get('/api/v1/sync/summary', syncSummaryHandler)
  return app
}

function request(db: SyncMemoryD1Database, path = '/api/v1/sync/summary') {
  const app = buildApp(db)
  const env = { DB: asD1(db) } as unknown as Env
  return app.request(path, {}, env)
}

async function parseBody(res: Response) {
  const body = (await res.json()) as { ok?: boolean; data?: unknown }
  return body
}

describe('sync summary endpoint', () => {
  it('returns counts and updated_at upper bounds for each entity', async () => {
    const memory = new SyncMemoryD1Database()
    const now = new Date('2026-08-04T19:20:31.000Z').toISOString()

    seedBookmark(memory, {
      id: 'b1',
      user_id: userId,
      title: 'live',
      url: 'https://live.example',
      revision: 'rev1',
      updated_at: now,
    })
    seedBookmark(memory, {
      id: 'b2',
      user_id: userId,
      title: 'trash',
      url: 'https://trash.example',
      revision: 'rev2',
      updated_at: '2026-01-01T00:00:00.000Z',
      deleted_at: '2026-01-02T00:00:00.000Z',
    })
    memory.tags.set('t1', {
      id: 't1',
      user_id: userId,
      name: 'AI',
      color: null,
      click_count: 0,
      last_clicked_at: null,
      created_at: now,
      updated_at: now,
      deleted_at: null,
    })
    memory.bookmarkFolders.set('f1', {
      id: 'f1',
      user_id: userId,
      name: 'Work',
      parent_id: null,
      position: 0,
      is_deleted: 0,
      deleted_at: null,
      created_at: now,
      updated_at: now,
    })
    memory.bookmarkFolders.set('f2', {
      id: 'f2',
      user_id: userId,
      name: 'Trash',
      parent_id: null,
      position: 1,
      is_deleted: 1,
      deleted_at: now,
      created_at: now,
      updated_at: now,
    })
    memory.tabGroups.set('g1', {
      id: 'g1',
      user_id: userId,
      title: 'Group A',
      parent_id: null,
      is_folder: 0,
      position: 0,
      color: null,
      tags: null,
      revision: 'r',
      is_deleted: 0,
      deleted_at: null,
      created_at: now,
      updated_at: now,
    })
    memory.tabGroupItems.set('i1', {
      id: 'i1',
      group_id: 'g1',
      title: 'Item 1',
      url: 'https://item1.example',
      favicon: null,
      position: 0,
      is_pinned: 0,
      is_todo: 0,
      is_archived: 0,
      created_at: now,
    })
    memory.tabGroupItems.set('i2', {
      id: 'i2',
      group_id: 'g1',
      title: 'Item 2',
      url: 'https://item2.example',
      favicon: null,
      position: 1,
      is_pinned: 0,
      is_todo: 0,
      is_archived: 0,
      created_at: now,
    })
    // Insert synthetic sync_changes with sequential ids 1 and 2.
    memory.syncChanges.push(
      {
        id: 1,
        change_id: 'c1',
        user_id: userId,
        device_id: 'd1',
        entity_type: 'bookmark',
        entity_id: 'b1',
        operation: 'upsert',
        revision: 'rev1',
        payload_json: null,
        changed_at: now,
      },
      {
        id: 2,
        change_id: 'c2',
        user_id: userId,
        device_id: 'd1',
        entity_type: 'bookmark',
        entity_id: 'b2',
        operation: 'delete',
        revision: 'rev2',
        payload_json: null,
        changed_at: now,
      },
    )

    const res = await request(memory)
    expect(res.status).toBe(200)

    // Without a cursor, pending defaults to 0 and cursorBound = max sync_changes.id
    const base = (await parseBody(res)) as {
      data: {
        entities: {
          bookmarks: { count: number; maxUpdatedAt: string | null }
          bookmark_folders: { count: number }
          tags: { count: number }
          tab_groups: { count: number }
          tab_group_items: { count: number; maxUpdatedAt: string | null }
        }
        pendingOperations: number
        cursorBound: number
        serverTime: string
      }
    }
    expect(base.data.entities.bookmarks).toEqual({ count: 1, maxUpdatedAt: now })
    expect(base.data.entities.bookmark_folders.count).toBe(1)
    expect(base.data.entities.tags.count).toBe(1)
    expect(base.data.entities.tab_groups.count).toBe(1)
    expect(base.data.entities.tab_group_items).toEqual({ count: 2, maxUpdatedAt: now })
    expect(base.data.pendingOperations).toBe(0)
    expect(base.data.cursorBound).toBe(2)
    expect(typeof base.data.serverTime).toBe('string')
  })

  it('respects ?after_id= when reporting pendingOperations', async () => {
    const memory = new SyncMemoryD1Database()
    const now = new Date().toISOString()
    for (let id = 1; id <= 4; id += 1) {
      memory.syncChanges.push({
        id,
        change_id: `c${id}`,
        user_id: userId,
        device_id: 'd1',
        entity_type: 'bookmark',
        entity_id: `b${id}`,
        operation: 'upsert',
        revision: 'rev',
        payload_json: null,
        changed_at: now,
      })
    }

    const res = await request(memory, '/api/v1/sync/summary?after_id=2')
    expect(res.status).toBe(200)
    const body = (await parseBody(res)) as {
      data: { pendingOperations: number; cursorBound: number }
    }
    expect(body.data.cursorBound).toBe(4)
    expect(body.data.pendingOperations).toBe(2)
  })
})
