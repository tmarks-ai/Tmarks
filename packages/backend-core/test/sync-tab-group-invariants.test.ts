import { describe, expect, it } from 'vitest'
import type { SyncEnvelope } from '@tmarks/contracts'
import { pushSyncOperations } from '../src/lib/sync/sync'
import { createSqliteD1, type SqliteD1Harness } from './helpers/sqlite-d1'

const USER = 'user-1'
const DEVICE = 'device-a'

let opCounter = 0

function envelope(entityId: string, payload: Record<string, unknown>): SyncEnvelope {
  opCounter += 1
  return {
    client_operation_id: `op-${opCounter}`,
    device_id: DEVICE,
    entity_type: 'tab_group',
    operation: 'upsert',
    entity_id: entityId,
    base_revision: null,
    created_at: new Date().toISOString(),
    ...({ payload } as Record<string, unknown>),
  } as SyncEnvelope
}

function groupRow(h: SqliteD1Harness, id: string) {
  return h.sqlite
    .prepare('SELECT id, parent_id FROM tab_groups WHERE id = ?')
    .get(id) as { id: string; parent_id: string | null } | undefined
}

describe('sync push tab-group parent invariants (mirror the REST plane)', () => {
  // Regression (audit N-5): applyTabGroupOperation only checked parent
  // ownership — unlike folders there is no two-level rule to make cycles
  // unreachable, so an API-key client could push parent_id = entityId
  // (self-parent) or mutually-parented groups, breaking the tree invariant
  // that buildTree's "server rejects cycles" comment relies on.
  it('accepts a legitimate nested structure', async () => {
    const harness = createSqliteD1(USER)
    const result = await pushSyncOperations(harness.db, USER, DEVICE, [
      envelope('group-a', { title: 'A', is_folder: true, parent_id: null, position: 0 }),
      envelope('group-b', { title: 'B', is_folder: true, parent_id: 'group-a', position: 0 }),
      envelope('group-c', { title: 'C', is_folder: true, parent_id: 'group-b', position: 0 }),
    ])
    expect(result.accepted).toHaveLength(3)
    expect(groupRow(harness, 'group-c')?.parent_id).toBe('group-b')
    harness.close()
  })

  it('rejects a tab group parented at itself', async () => {
    const harness = createSqliteD1(USER)
    const result = await pushSyncOperations(harness.db, USER, DEVICE, [
      envelope('group-a', { title: 'A', is_folder: true, parent_id: null, position: 0 }),
      envelope('group-a', { title: 'A', is_folder: true, parent_id: 'group-a', position: 0 }),
    ])
    expect(result.rejected).toHaveLength(1)
    // 专用终态码 + 附带服务器当前状态 → 客户端立即停试并可用"接受远端"恢复。
    expect(result.rejected[0].code).toBe('INVALID_PARENT_TREE')
    expect(result.rejected[0].server_payload).toMatchObject({ id: 'group-a', parent_id: null })
    expect(result.rejected[0].server_revision).toBeTruthy()
    expect(groupRow(harness, 'group-a')?.parent_id).toBeNull()
    harness.close()
  })

  it('rejects a two-node cycle pushed across separate batches', async () => {
    const harness = createSqliteD1(USER)
    await pushSyncOperations(harness.db, USER, DEVICE, [
      envelope('group-a', { title: 'A', is_folder: true, parent_id: null, position: 0 }),
      envelope('group-b', { title: 'B', is_folder: true, parent_id: null, position: 0 }),
    ])
    await pushSyncOperations(harness.db, USER, DEVICE, [
      envelope('group-a', { title: 'A', is_folder: true, parent_id: 'group-b', position: 0 }),
    ])

    const result = await pushSyncOperations(harness.db, USER, DEVICE, [
      envelope('group-b', { title: 'B', is_folder: true, parent_id: 'group-a', position: 0 }),
    ])
    expect(result.rejected).toHaveLength(1)
    expect(result.rejected[0].code).toBe('INVALID_PARENT_TREE')
    expect(result.rejected[0].server_payload).toMatchObject({ id: 'group-b', parent_id: null })
    expect(groupRow(harness, 'group-b')?.parent_id).toBeNull()
    expect(groupRow(harness, 'group-a')?.parent_id).toBe('group-b')
    harness.close()
  })

  it('rejects a cycle formed inside one push batch (later op sees earlier op)', async () => {
    const harness = createSqliteD1(USER)
    await pushSyncOperations(harness.db, USER, DEVICE, [
      envelope('group-a', { title: 'A', is_folder: true, parent_id: null, position: 0 }),
      envelope('group-b', { title: 'B', is_folder: true, parent_id: null, position: 0 }),
    ])

    const result = await pushSyncOperations(harness.db, USER, DEVICE, [
      envelope('group-a', { title: 'A', is_folder: true, parent_id: 'group-b', position: 0 }),
      envelope('group-b', { title: 'B', is_folder: true, parent_id: 'group-a', position: 0 }),
    ])
    // The second op closes the cycle and is rejected; the first already applied.
    expect(result.accepted).toHaveLength(1)
    expect(result.rejected).toHaveLength(1)
    expect(groupRow(harness, 'group-a')?.parent_id).toBe('group-b')
    expect(groupRow(harness, 'group-b')?.parent_id).toBeNull()
    harness.close()
  })

  it('rejects moving a group under its own deep descendant', async () => {
    const harness = createSqliteD1(USER)
    await pushSyncOperations(harness.db, USER, DEVICE, [
      envelope('g1', { title: '1', is_folder: true, parent_id: null, position: 0 }),
      envelope('g2', { title: '2', is_folder: true, parent_id: 'g1', position: 0 }),
      envelope('g3', { title: '3', is_folder: true, parent_id: 'g2', position: 0 }),
    ])

    const result = await pushSyncOperations(harness.db, USER, DEVICE, [
      envelope('g1', { title: '1', is_folder: true, parent_id: 'g3', position: 0 }),
    ])
    expect(result.rejected).toHaveLength(1)
    expect(groupRow(harness, 'g1')?.parent_id).toBeNull()
    harness.close()
  })
})
