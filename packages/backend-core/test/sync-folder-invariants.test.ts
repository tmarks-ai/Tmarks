import { describe, expect, it } from 'vitest'
import type { SyncEnvelope } from '@tmarks/contracts'
import { pushSyncOperations } from '../src/lib/sync/sync'
import { createSqliteD1, type SqliteD1Harness } from './helpers/sqlite-d1'

const USER = 'user-1'
const OTHER = 'user-other'
const DEVICE = 'device-a'

let opCounter = 0

function envelope(entityId: string, payload: Record<string, unknown>): SyncEnvelope {
  opCounter += 1
  return {
    client_operation_id: `op-${opCounter}`,
    device_id: DEVICE,
    entity_type: 'bookmark_folder',
    operation: 'upsert',
    entity_id: entityId,
    base_revision: null,
    created_at: new Date().toISOString(),
    ...({ payload } as Record<string, unknown>),
  } as SyncEnvelope
}

function folderRow(h: SqliteD1Harness, id: string) {
  return h.sqlite
    .prepare('SELECT id, name, parent_id FROM bookmark_folders WHERE id = ?')
    .get(id) as { id: string; name: string; parent_id: string | null } | undefined
}

describe('sync push folder invariants (mirror the REST plane)', () => {
  // Regression (audit H-5): applyBookmarkFolderOperation only checked parent
  // ownership, so an API-key client could push parent_id = entityId or
  // mutually-parented folders and buildFolderTree silently dropped every node
  // on the cycle.
  it('accepts a legitimate two-level structure', async () => {
    const harness = createSqliteD1(USER)
    const result = await pushSyncOperations(harness.db, USER, DEVICE, [
      envelope('folder-root', { name: 'Root', parent_id: null, position: 0 }),
      envelope('folder-child', { name: 'Child', parent_id: 'folder-root', position: 0 }),
    ])
    expect(result.accepted).toHaveLength(2)
    expect(folderRow(harness, 'folder-child')?.parent_id).toBe('folder-root')
    harness.close()
  })

  it('rejects a folder parented at itself', async () => {
    const harness = createSqliteD1(USER)
    const result = await pushSyncOperations(harness.db, USER, DEVICE, [
      envelope('folder-self', { name: 'Self', parent_id: 'folder-self', position: 0 }),
    ])
    expect(result.accepted).toHaveLength(0)
    expect(result.rejected[0]?.message).toContain('own parent')
    harness.close()
  })

  it('rejects a level-2 folder being used as a parent (three-level nesting)', async () => {
    const harness = createSqliteD1(USER)
    await pushSyncOperations(harness.db, USER, DEVICE, [
      envelope('folder-root', { name: 'Root', parent_id: null, position: 0 }),
      envelope('folder-child', { name: 'Child', parent_id: 'folder-root', position: 0 }),
    ])
    const result = await pushSyncOperations(harness.db, USER, DEVICE, [
      envelope('folder-grandchild', { name: 'GC', parent_id: 'folder-child', position: 0 }),
    ])
    expect(result.accepted).toHaveLength(0)
    expect(result.rejected[0]?.message).toContain('primary and secondary')
    harness.close()
  })

  it('rejects moving a folder with children under another folder (and thus cycles)', async () => {
    const harness = createSqliteD1(USER)
    await pushSyncOperations(harness.db, USER, DEVICE, [
      envelope('folder-a', { name: 'A', parent_id: null, position: 0 }),
      envelope('folder-a1', { name: 'A1', parent_id: 'folder-a', position: 0 }),
      envelope('folder-b', { name: 'B', parent_id: null, position: 1 }),
    ])
    // A has children: moving A under B would need a third level (and is the
    // only remaining shape in which a cycle could be assembled).
    const result = await pushSyncOperations(harness.db, USER, DEVICE, [
      envelope('folder-a', { name: 'A', parent_id: 'folder-b', position: 0 }),
    ])
    expect(result.accepted).toHaveLength(0)
    expect(result.rejected[0]?.message).toContain('children')
    expect(folderRow(harness, 'folder-a')?.parent_id).toBeNull()
    harness.close()
  })

  it('rejects a parent owned by another account', async () => {
    const harness = createSqliteD1(USER)
    harness.sqlite
      .prepare('INSERT INTO users (id, username, password_hash) VALUES (?, ?, ?)')
      .run(OTHER, 'other', 'x')
    harness.sqlite
      .prepare(
        'INSERT INTO bookmark_folders (id, user_id, name) VALUES (?, ?, ?)'
      )
      .run('folder-other', OTHER, 'Foreign')

    const result = await pushSyncOperations(harness.db, USER, DEVICE, [
      envelope('folder-mine', { name: 'Mine', parent_id: 'folder-other', position: 0 }),
    ])
    expect(result.accepted).toHaveLength(0)
    expect(result.rejected[0]?.message).toContain('not found for this account')
    harness.close()
  })
})

describe('sync push payload caps (mirror the REST plane)', () => {
  function bookmarkEnvelope(id: string, title: string): SyncEnvelope {
    opCounter += 1
    return {
      client_operation_id: `bm-${opCounter}`,
      device_id: DEVICE,
      entity_type: 'bookmark',
      operation: 'upsert',
      entity_id: id,
      base_revision: null,
      created_at: new Date().toISOString(),
      payload: { title, url: 'https://example.com/caps', tag_ids: [] },
    } as SyncEnvelope
  }

  // Regression (audit N-3): the REST plane caps title at 500; the sync push
  // plane accepted unbounded strings (doubled via sync_changes.payload_json).
  it('truncates an oversized bookmark title to 500 chars', async () => {
    const harness = createSqliteD1(USER)
    const result = await pushSyncOperations(harness.db, USER, DEVICE, [
      bookmarkEnvelope('bm-cap', 'x'.repeat(10_000)),
    ])
    expect(result.accepted).toHaveLength(1)
    const row = harness.sqlite
      .prepare('SELECT length(title) AS n FROM bookmarks WHERE id = ?')
      .get('bm-cap') as { n: number }
    expect(row.n).toBe(500)
    harness.close()
  })

  it('truncates an oversized folder name to 120 chars', async () => {
    const harness = createSqliteD1(USER)
    const result = await pushSyncOperations(harness.db, USER, DEVICE, [
      envelope('folder-cap', { name: 'y'.repeat(5_000), parent_id: null, position: 0 }),
    ])
    expect(result.accepted).toHaveLength(1)
    const row = harness.sqlite
      .prepare('SELECT length(name) AS n FROM bookmark_folders WHERE id = ?')
      .get('folder-cap') as { n: number }
    expect(row.n).toBe(120)
    harness.close()
  })
})
