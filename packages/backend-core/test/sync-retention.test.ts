import { describe, expect, it } from 'vitest'
import { compactSyncChanges, pruneStaleSyncDevices, sweepOrphanedItemRevisions } from '../src/lib/sync/sync-retention'
import { listSyncChanges } from '../src/lib/sync/sync'
import { emitSyncChange } from '../src/lib/sync/sync-emit'
import { createSqliteD1, type SqliteD1Harness } from './helpers/sqlite-d1'

const USER = 'user-1'
const OLD = '2024-01-01T00:00:00.000Z'

function seedBookmark(h: SqliteD1Harness, id: string, title: string) {
  h.sqlite
    .prepare(`INSERT INTO bookmarks (id, user_id, title, url) VALUES (?, ?, ?, ?)`)
    .run(id, USER, title, `https://example.com/${id}`)
}

/** Backdates every existing change past the compaction grace window. */
function age(h: SqliteD1Harness) {
  h.sqlite.prepare(`UPDATE sync_changes SET changed_at = ?`).run(OLD)
}

function changeCount(h: SqliteD1Harness): number {
  const row = h.sqlite.prepare('SELECT COUNT(*) AS n FROM sync_changes WHERE user_id = ?').get(USER) as { n: number }
  return row.n
}

describe('sync_changes compaction', () => {
  it('keeps only the newest change per entity', async () => {
    const h = createSqliteD1(USER)
    seedBookmark(h, 'b1', 'v1')

    for (const title of ['v1', 'v2', 'v3']) {
      h.sqlite.prepare('UPDATE bookmarks SET title = ? WHERE id = ?').run(title, 'b1')
      await emitSyncChange(h.db, USER, 'bookmark', 'b1', 'upsert')
    }
    expect(changeCount(h)).toBe(3)
    age(h)

    const removed = await compactSyncChanges(h.db, USER)
    expect(removed).toBe(2)
    expect(changeCount(h)).toBe(1)

    // The surviving row must be the newest state, not an arbitrary one.
    const remaining = await listSyncChanges(h.db, USER, null, 10)
    expect((remaining.changes[0].payload as { title: string }).title).toBe('v3')
    h.close()
  })

  /**
   * The safety property that makes compaction sound: because each change carries
   * a full state snapshot, a client resuming from *any* cursor still sees the
   * latest state of every entity. If that ever stopped holding, compaction would
   * silently strand long-offline devices.
   */
  it('leaves every entity reachable from any cursor', async () => {
    const h = createSqliteD1(USER)
    seedBookmark(h, 'b1', 'a1')
    seedBookmark(h, 'b2', 'b1')

    const cursors: string[] = []
    for (let round = 0; round < 3; round += 1) {
      for (const id of ['b1', 'b2']) {
        h.sqlite.prepare('UPDATE bookmarks SET title = ? WHERE id = ?').run(`${id}-r${round}`, id)
        await emitSyncChange(h.db, USER, 'bookmark', id, 'upsert')
      }
      cursors.push((await listSyncChanges(h.db, USER, null, 100)).cursor)
    }
    age(h)
    await compactSyncChanges(h.db, USER)

    // Resuming from the very start, and from each historical cursor, must always
    // surface the final state of both bookmarks.
    for (const cursor of [null, ...cursors]) {
      const seen = new Map<string, string>()
      const page = await listSyncChanges(h.db, USER, cursor, 100)
      for (const change of page.changes) {
        seen.set(change.entity_id, (change.payload as { title: string }).title)
      }
      // A cursor past the last surviving row legitimately yields nothing new.
      for (const [entity, title] of seen) {
        expect(title, `entity ${entity} from cursor ${cursor}`).toBe(`${entity}-r2`)
      }
    }

    const fromScratch = await listSyncChanges(h.db, USER, null, 100)
    expect(new Set(fromScratch.changes.map((c) => c.entity_id))).toEqual(new Set(['b1', 'b2']))
    h.close()
  })

  it('preserves delete tombstones', async () => {
    const h = createSqliteD1(USER)
    seedBookmark(h, 'b1', 'v1')
    await emitSyncChange(h.db, USER, 'bookmark', 'b1', 'upsert')
    h.sqlite.prepare('DELETE FROM bookmarks WHERE id = ?').run('b1')
    await emitSyncChange(h.db, USER, 'bookmark', 'b1', 'delete')
    age(h)

    await compactSyncChanges(h.db, USER)

    const remaining = await listSyncChanges(h.db, USER, null, 10)
    expect(remaining.changes).toHaveLength(1)
    expect(remaining.changes[0].operation).toBe('delete')
    h.close()
  })

  it('does not touch recent changes, so an in-flight pull is unaffected', async () => {
    const h = createSqliteD1(USER)
    seedBookmark(h, 'b1', 'v1')
    await emitSyncChange(h.db, USER, 'bookmark', 'b1', 'upsert')
    await emitSyncChange(h.db, USER, 'bookmark', 'b1', 'upsert')

    // No backdating: both rows are inside the grace window.
    expect(await compactSyncChanges(h.db, USER)).toBe(0)
    expect(changeCount(h)).toBe(2)
    h.close()
  })

  it('never touches another account', async () => {
    const h = createSqliteD1(USER)
    h.sqlite.prepare('INSERT INTO users (id, username, password_hash) VALUES (?, ?, ?)').run('user-2', 'u2', 'x')
    h.sqlite.prepare(`INSERT INTO bookmarks (id, user_id, title, url) VALUES ('o1','user-2','T','https://o.example/')`).run()
    await emitSyncChange(h.db, 'user-2', 'bookmark', 'o1', 'upsert')
    await emitSyncChange(h.db, 'user-2', 'bookmark', 'o1', 'upsert')
    age(h)

    await compactSyncChanges(h.db, USER)

    const other = h.sqlite.prepare("SELECT COUNT(*) AS n FROM sync_changes WHERE user_id = 'user-2'").get() as { n: number }
    expect(other.n).toBe(2)
    h.close()
  })
})

describe('orphaned item revision sweep', () => {
  function seedItem(h: SqliteD1Harness, id: string, group = 'g1') {
    h.sqlite.prepare('INSERT OR IGNORE INTO tab_groups (id, user_id, title) VALUES (?, ?, ?)').run(group, USER, 'G')
    h.sqlite.prepare('INSERT INTO tab_group_items (id, group_id, title, url, position) VALUES (?, ?, ?, ?, 0)').run(id, group, 'T', `https://example.com/${id}`)
    h.sqlite.prepare(
      "INSERT INTO sync_entity_revisions (user_id, entity_type, entity_id, revision, updated_at) VALUES (?, 'tab_group_item', ?, ?, ?)"
    ).run(USER, id, `rev-${id}`, '2024-01-01T00:00:00.000Z')
  }

  it('removes revision rows of hard-deleted items, keeps live ones', async () => {
    const h = createSqliteD1(USER)
    seedItem(h, 'i-live')
    seedItem(h, 'i-gone')
    h.sqlite.prepare('DELETE FROM tab_group_items WHERE id = ?').run('i-gone')

    const removed = await sweepOrphanedItemRevisions(h.db)

    expect(removed).toBe(1)
    const left = h.sqlite.prepare("SELECT entity_id FROM sync_entity_revisions WHERE entity_type = 'tab_group_item'").all() as { entity_id: string }[]
    expect(left.map((r) => r.entity_id)).toEqual(['i-live'])
    h.close()
  })

  // The deletion paths span item delete, group replace, dedup, permanent group
  // delete — the sweep must not care which one ran.
  it('sweeps items orphaned by a whole-group delete', async () => {
    const h = createSqliteD1(USER)
    seedItem(h, 'i1', 'g-doomed')
    seedItem(h, 'i2', 'g-doomed')
    seedItem(h, 'i3', 'g-stays')
    h.sqlite.prepare('DELETE FROM tab_group_items WHERE group_id = ?').run('g-doomed')

    expect(await sweepOrphanedItemRevisions(h.db)).toBe(2)
    const left = h.sqlite.prepare("SELECT entity_id FROM sync_entity_revisions WHERE entity_type = 'tab_group_item'").all() as { entity_id: string }[]
    expect(left.map((r) => r.entity_id)).toEqual(['i3'])
    h.close()
  })

  it('leaves other entity types alone even when their rows are stale', async () => {
    const h = createSqliteD1(USER)
    // A tag revision row whose tag no longer exists — tags are soft-deleted in
    // reality, but the sweep must scope strictly to tab_group_item regardless.
    h.sqlite.prepare(
      "INSERT INTO sync_entity_revisions (user_id, entity_type, entity_id, revision, updated_at) VALUES (?, 'tag', 'ghost-tag', 'r', ?)"
    ).run(USER, '2024-01-01T00:00:00.000Z')

    expect(await sweepOrphanedItemRevisions(h.db)).toBe(0)
    const kept = h.sqlite.prepare("SELECT COUNT(*) AS n FROM sync_entity_revisions WHERE entity_id = 'ghost-tag'").get() as { n: number }
    expect(kept.n).toBe(1)
    h.close()
  })
})

describe('stale device pruning', () => {
  function seedDevice(h: SqliteD1Harness, id: string, lastSeen: string | null) {
    h.sqlite.prepare('INSERT INTO sync_devices (id, user_id, last_seen_at) VALUES (?, ?, ?)').run(id, USER, lastSeen)
  }

  it('drops devices silent past the window, keeps active ones', async () => {
    const h = createSqliteD1(USER)
    const now = Date.now()
    seedDevice(h, 'fresh', new Date(now).toISOString())
    seedDevice(h, 'yesterday', new Date(now - 24 * 60 * 60 * 1000).toISOString())
    seedDevice(h, 'ancient', new Date(now - 91 * 24 * 60 * 60 * 1000).toISOString())
    seedDevice(h, 'never-seen', null)

    const removed = await pruneStaleSyncDevices(h.db)

    expect(removed).toBe(2)
    const left = h.sqlite.prepare('SELECT id FROM sync_devices ORDER BY id').all() as { id: string }[]
    expect(left.map((r) => r.id)).toEqual(['fresh', 'yesterday'])
    h.close()
  })
})
