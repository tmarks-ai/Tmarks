import { describe, expect, it } from 'vitest'
import type { SyncEnvelope } from '@tmarks/contracts'
import { listSyncChanges, pushSyncOperations } from '@tmarks/backend-core'
import {
  asD1,
  seedBookmark,
  SyncMemoryD1Database,
} from './helpers/sync-d1-harness'

const userId = 'single-user'
const deviceId = 'extension-device'

describe('single-user sync data flow', () => {
  it('pushes a bookmark with tag names and exposes it through changes', async () => {
    const memory = new SyncMemoryD1Database()
    const db = asD1(memory)
    const operation = bookmarkOperation({
      client_operation_id: 'op-bookmark-create',
      entity_id: 'bookmark-1',
      payload: {
        title: 'TMarks',
        url: 'https://tmarks.example',
        description: 'Extension workspace',
        is_pinned: true,
        tag_names: ['AI', 'Tools'],
      },
    })

    const pushed = await pushSyncOperations(db, userId, deviceId, [operation])
    const changes = await listSyncChanges(db, userId, null, 10)

    expect(pushed.accepted).toHaveLength(1)
    expect(pushed.conflicts).toHaveLength(0)
    expect(pushed.rejected).toHaveLength(0)
    expect(memory.bookmarks.get('bookmark-1')).toMatchObject({
      title: 'TMarks',
      url: 'https://tmarks.example',
      is_pinned: 1,
    })
    expect(Array.from(memory.tags.values()).map((tag) => tag.name).sort()).toEqual(['AI', 'Tools'])
    expect(memory.bookmarkTags).toHaveLength(2)
    expect(changes.changes).toHaveLength(1)
    expect(changes.changes[0]).toMatchObject({
      entity_type: 'bookmark',
      entity_id: 'bookmark-1',
      operation: 'upsert',
      revision: pushed.accepted[0].revision,
    })
    expect((changes.changes[0].payload as { tags: Array<{ name: string }> }).tags.map((tag) => tag.name).sort()).toEqual(['AI', 'Tools'])
  })

  it('replays identical client operations without duplicating sync changes', async () => {
    const memory = new SyncMemoryD1Database()
    const db = asD1(memory)
    const operation = bookmarkOperation({
      client_operation_id: 'op-idempotent',
      entity_id: 'bookmark-idempotent',
      payload: { title: 'Idempotent', url: 'https://idempotent.example' },
    })

    const first = await pushSyncOperations(db, userId, deviceId, [operation])
    const second = await pushSyncOperations(db, userId, deviceId, [operation])

    expect(first.accepted).toEqual(second.accepted)
    expect(second.conflicts).toHaveLength(0)
    expect(second.rejected).toHaveLength(0)
    expect(memory.syncChanges).toHaveLength(1)
  })

  it('rejects reused client operation ids with different payloads', async () => {
    const memory = new SyncMemoryD1Database()
    const db = asD1(memory)
    const operation = bookmarkOperation({
      client_operation_id: 'op-reused',
      entity_id: 'bookmark-reused',
      payload: { title: 'Original', url: 'https://reused.example' },
    })
    const changedOperation = bookmarkOperation({
      client_operation_id: 'op-reused',
      entity_id: 'bookmark-reused',
      payload: { title: 'Changed', url: 'https://reused.example' },
    })

    await pushSyncOperations(db, userId, deviceId, [operation])
    const replay = await pushSyncOperations(db, userId, deviceId, [changedOperation])

    expect(replay.accepted).toHaveLength(0)
    expect(replay.conflicts).toHaveLength(0)
    expect(replay.rejected).toEqual([
      expect.objectContaining({
        client_operation_id: 'op-reused',
        code: 'IDEMPOTENCY_CONFLICT',
      }),
    ])
    expect(memory.syncChanges).toHaveLength(1)
  })

  it('returns a conflict when base revision is stale', async () => {
    const memory = new SyncMemoryD1Database()
    const db = asD1(memory)
    seedBookmark(memory, {
      id: 'bookmark-existing',
      user_id: userId,
      title: 'Server title',
      url: 'https://existing.example',
      revision: 'rev_server_current',
    })

    const pushed = await pushSyncOperations(db, userId, deviceId, [
      bookmarkOperation({
        client_operation_id: 'op-stale',
        entity_id: 'bookmark-existing',
        base_revision: 'rev_old_client',
        payload: { title: 'Client title', url: 'https://existing.example' },
      }),
    ])

    expect(pushed.accepted).toHaveLength(0)
    expect(pushed.rejected).toHaveLength(0)
    expect(pushed.conflicts).toEqual([
      expect.objectContaining({
        client_operation_id: 'op-stale',
        entity_id: 'bookmark-existing',
        server_revision: 'rev_server_current',
        reason: 'revision_mismatch',
      }),
    ])
    expect(pushed.conflicts[0].server_payload).toMatchObject({
      title: 'Server title',
      url: 'https://existing.example',
    })
    expect(memory.syncChanges).toHaveLength(0)
  })

  it('records bookmark deletion as a sync change', async () => {
    const memory = new SyncMemoryD1Database()
    const db = asD1(memory)
    seedBookmark(memory, {
      id: 'bookmark-delete',
      user_id: userId,
      title: 'Delete me',
      url: 'https://delete.example',
      revision: 'rev_before_delete',
    })

    const pushed = await pushSyncOperations(db, userId, deviceId, [
      bookmarkOperation({
        client_operation_id: 'op-delete',
        entity_id: 'bookmark-delete',
        operation: 'delete',
        base_revision: 'rev_before_delete',
        payload: { id: 'bookmark-delete' },
      }),
    ])
    const changes = await listSyncChanges(db, userId, null, 10)

    expect(pushed.accepted).toHaveLength(1)
    expect(memory.bookmarks.get('bookmark-delete')?.deleted_at).toEqual(expect.any(String))
    expect(changes.changes).toHaveLength(1)
    expect(changes.changes[0]).toMatchObject({
      entity_type: 'bookmark',
      entity_id: 'bookmark-delete',
      operation: 'delete',
      revision: pushed.accepted[0].revision,
    })
    expect(changes.changes[0].payload).toMatchObject({
      id: 'bookmark-delete',
      deleted_at: expect.any(String),
    })
  })
})

function bookmarkOperation(
  overrides: Partial<SyncEnvelope> & {
    client_operation_id: string
    entity_id: string
    payload: Record<string, unknown>
  },
): SyncEnvelope {
  return {
    device_id: deviceId,
    entity_type: 'bookmark',
    operation: 'upsert',
    base_revision: null,
    created_at: new Date().toISOString(),
    ...overrides,
  }
}
