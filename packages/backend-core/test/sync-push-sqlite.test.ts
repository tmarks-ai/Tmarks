import { describe, expect, it } from 'vitest'
import type { SyncEnvelope } from '@tmarks/contracts'
import { pushSyncOperations } from '../src/lib/sync/sync'
import { createSqliteD1, type SqliteD1Harness } from './helpers/sqlite-d1'

const USER = 'user-1'
const DEVICE = 'device-a'

let opCounter = 0

function bookmarkOp(overrides: Partial<SyncEnvelope> & { payload: Record<string, unknown> }): SyncEnvelope {
  opCounter += 1
  return {
    client_operation_id: `op-${opCounter}`,
    device_id: DEVICE,
    entity_type: 'bookmark',
    operation: 'upsert',
    entity_id: 'bm-1',
    base_revision: null,
    created_at: new Date().toISOString(),
    ...overrides,
  } as SyncEnvelope
}

function readBookmark(harness: SqliteD1Harness, id: string) {
  return harness.sqlite
    .prepare('SELECT id, title, url, deleted_at FROM bookmarks WHERE id = ?')
    .get(id) as { id: string; title: string; url: string; deleted_at: string | null } | undefined
}

describe('sync push against real SQLite', () => {
  // Regression: the upsert keyed on ON CONFLICT(user_id, url), so pointing one
  // bookmark at a URL another bookmark already owned rewrote *that other row*
  // and left the intended one untouched — while still reporting success.
  it('never rewrites a different bookmark when a URL collides', async () => {
    const harness = createSqliteD1(USER)

    await pushSyncOperations(harness.db, USER, DEVICE, [
      bookmarkOp({ entity_id: 'bm-a', payload: { title: 'A', url: 'https://a.example/' } }),
      bookmarkOp({ entity_id: 'bm-b', payload: { title: 'B', url: 'https://b.example/' } }),
    ])

    const result = await pushSyncOperations(harness.db, USER, DEVICE, [
      bookmarkOp({ entity_id: 'bm-a', payload: { title: 'A renamed', url: 'https://b.example/' } }),
    ])

    // The operation must be refused, not silently applied to the wrong row.
    expect(result.accepted).toHaveLength(0)
    expect(result.rejected).toHaveLength(1)
    expect(result.rejected[0].code).toBe('DUPLICATE_URL')

    expect(readBookmark(harness, 'bm-b')).toMatchObject({ title: 'B', url: 'https://b.example/' })
    expect(readBookmark(harness, 'bm-a')).toMatchObject({ title: 'A', url: 'https://a.example/' })
    harness.close()
  })

  // Regression: a URL collision used to throw a constraint error out of
  // pushSyncOperations, failing the entire batch (and every later retry of it).
  it('keeps the rest of the batch applied when one operation collides', async () => {
    const harness = createSqliteD1(USER)

    await pushSyncOperations(harness.db, USER, DEVICE, [
      bookmarkOp({ entity_id: 'bm-a', payload: { title: 'A', url: 'https://a.example/' } }),
      bookmarkOp({ entity_id: 'bm-b', payload: { title: 'B', url: 'https://b.example/' } }),
    ])

    const result = await pushSyncOperations(harness.db, USER, DEVICE, [
      // Retargets an existing bookmark onto a URL another row already owns.
      bookmarkOp({ entity_id: 'bm-b', payload: { title: 'B moved', url: 'https://a.example/' } }),
      bookmarkOp({ entity_id: 'bm-c', payload: { title: 'C', url: 'https://c.example/' } }),
    ])

    expect(result.rejected).toHaveLength(1)
    expect(result.rejected[0].code).toBe('DUPLICATE_URL')
    expect(result.accepted).toHaveLength(1)
    // The operation after the collision still landed.
    expect(readBookmark(harness, 'bm-c')).toMatchObject({ title: 'C' })
    expect(readBookmark(harness, 'bm-b')).toMatchObject({ title: 'B', url: 'https://b.example/' })
    harness.close()
  })

  // Saving the same URL from a second device generates a different local id;
  // that is a merge, not a collision, and must resolve onto the canonical row.
  it('merges a duplicate URL pushed under a new id onto the existing bookmark', async () => {
    const harness = createSqliteD1(USER)

    await pushSyncOperations(harness.db, USER, DEVICE, [
      bookmarkOp({ entity_id: 'bm-a', payload: { title: 'A', url: 'https://a.example/' } }),
    ])

    const result = await pushSyncOperations(harness.db, USER, DEVICE, [
      bookmarkOp({ entity_id: 'bm-other-device', payload: { title: 'A from phone', url: 'https://a.example/' } }),
    ])

    expect(result.rejected).toHaveLength(0)
    expect(result.accepted).toHaveLength(1)
    expect(result.accepted[0].entity_id).toBe('bm-a')
    expect(readBookmark(harness, 'bm-other-device')).toBeUndefined()
    expect(readBookmark(harness, 'bm-a')).toMatchObject({ title: 'A from phone' })
    harness.close()
  })

  // Regression: an upsert from a client that had not seen a server-side delete
  // silently cleared deleted_at, pulling the bookmark back out of the trash.
  it('raises a conflict instead of resurrecting a deleted bookmark', async () => {
    const harness = createSqliteD1(USER)

    await pushSyncOperations(harness.db, USER, DEVICE, [
      bookmarkOp({ entity_id: 'bm-a', payload: { title: 'A', url: 'https://a.example/' } }),
    ])

    // Deleted elsewhere (e.g. the web app).
    harness.sqlite
      .prepare('UPDATE bookmarks SET deleted_at = ? WHERE id = ?')
      .run('2024-01-01T00:00:00.000Z', 'bm-a')

    const result = await pushSyncOperations(harness.db, USER, DEVICE, [
      bookmarkOp({ entity_id: 'bm-a', base_revision: null, payload: { title: 'A edited', url: 'https://a.example/' } }),
    ])

    expect(result.accepted).toHaveLength(0)
    expect(result.conflicts).toHaveLength(1)
    expect(result.conflicts[0].reason).toBe('deleted_on_server')
    expect(readBookmark(harness, 'bm-a')?.deleted_at).not.toBeNull()
    harness.close()
  })

  // The mirror case: re-saving a page whose old bookmark sits in the trash is a
  // normal user action and must not surface a conflict dialog.
  it('revives a trashed bookmark when the same URL is saved under a new id', async () => {
    const harness = createSqliteD1(USER)

    await pushSyncOperations(harness.db, USER, DEVICE, [
      bookmarkOp({ entity_id: 'bm-old', payload: { title: 'Old', url: 'https://a.example/' } }),
    ])
    harness.sqlite
      .prepare('UPDATE bookmarks SET deleted_at = ? WHERE id = ?')
      .run('2024-01-01T00:00:00.000Z', 'bm-old')

    const result = await pushSyncOperations(harness.db, USER, DEVICE, [
      bookmarkOp({ entity_id: 'bm-new', payload: { title: 'Fresh', url: 'https://a.example/' } }),
    ])

    expect(result.conflicts).toHaveLength(0)
    expect(result.accepted).toHaveLength(1)
    // Resolved onto the canonical existing row rather than creating a duplicate.
    expect(result.accepted[0].entity_id).toBe('bm-old')
    expect(readBookmark(harness, 'bm-old')).toMatchObject({ title: 'Fresh', deleted_at: null })
    harness.close()
  })

  // Regression: renaming a tag onto an existing name rewrote that other tag.
  it('never rewrites a different tag when a name collides', async () => {
    const harness = createSqliteD1(USER)

    await pushSyncOperations(harness.db, USER, DEVICE, [
      bookmarkOp({ entity_type: 'tag', entity_id: 'tag-a', payload: { name: 'alpha' } }),
      bookmarkOp({ entity_type: 'tag', entity_id: 'tag-b', payload: { name: 'beta' } }),
    ])

    const result = await pushSyncOperations(harness.db, USER, DEVICE, [
      bookmarkOp({ entity_type: 'tag', entity_id: 'tag-a', payload: { name: 'beta' } }),
    ])

    expect(result.rejected).toHaveLength(1)
    expect(result.rejected[0].code).toBe('TAG_EXISTS')

    const tagB = harness.sqlite.prepare('SELECT id, name FROM tags WHERE id = ?').get('tag-b')
    expect(tagB).toMatchObject({ name: 'beta' })
    const tagA = harness.sqlite.prepare('SELECT id, name FROM tags WHERE id = ?').get('tag-a')
    expect(tagA).toMatchObject({ name: 'alpha' })
    harness.close()
  })

  // Regression: the tag sync plane stored names at full length while the REST
  // planes clamp to 50 — a 55-char name landed intact here and the bookmark
  // plane's resolveOrCreateTagIds would later miss it and mint a 50-char
  // near-duplicate row.
  it('clamps tag names to the REST 50-char cap', async () => {
    const harness = createSqliteD1(USER)

    await pushSyncOperations(harness.db, USER, DEVICE, [
      bookmarkOp({ entity_type: 'tag', entity_id: 'tag-long', payload: { name: 'a'.repeat(55) } }),
    ])

    const row = harness.sqlite.prepare('SELECT name FROM tags WHERE id = ?').get('tag-long') as { name: string }
    expect(row.name).toBe('a'.repeat(50))

    // The clamped name joins the by-name merge as-is: a second device pushing
    // the same tag under a new id resolves onto the canonical row (mirroring
    // the bookmark URL merge), not a TAG_EXISTS rejection or a second row.
    const result = await pushSyncOperations(harness.db, USER, DEVICE, [
      bookmarkOp({ entity_type: 'tag', entity_id: 'tag-twin', payload: { name: 'a'.repeat(50) } }),
    ])
    expect(result.rejected).toHaveLength(0)
    expect(result.accepted).toHaveLength(1)
    expect(result.accepted[0].entity_id).toBe('tag-long')
    const count = harness.sqlite.prepare('SELECT COUNT(*) AS n FROM tags').get() as { n: number }
    expect(count.n).toBe(1)
    harness.close()
  })

  // REST parity: POST /tags rejects an empty name; the sync plane must not
  // store a nameless row either.
  it('rejects an empty tag name instead of storing a nameless row', async () => {
    const harness = createSqliteD1(USER)

    const result = await pushSyncOperations(harness.db, USER, DEVICE, [
      bookmarkOp({ entity_type: 'tag', entity_id: 'tag-empty', payload: { name: '   ' } }),
    ])

    expect(result.accepted).toHaveLength(0)
    expect(result.rejected).toHaveLength(1)
    expect(result.rejected[0].code).toBe('VALIDATION_FAILED')
    const count = harness.sqlite.prepare('SELECT COUNT(*) AS n FROM tags').get() as { n: number }
    expect(count.n).toBe(0)
    harness.close()
  })

  it('records a sync change for every accepted operation', async () => {
    const harness = createSqliteD1(USER)

    await pushSyncOperations(harness.db, USER, DEVICE, [
      bookmarkOp({ entity_id: 'bm-a', payload: { title: 'A', url: 'https://a.example/' } }),
    ])

    const changes = harness.sqlite
      .prepare('SELECT entity_type, entity_id, operation FROM sync_changes WHERE user_id = ?')
      .all(USER)
    expect(changes).toHaveLength(1)
    expect(changes[0]).toMatchObject({ entity_type: 'bookmark', entity_id: 'bm-a', operation: 'upsert' })
    harness.close()
  })
})
