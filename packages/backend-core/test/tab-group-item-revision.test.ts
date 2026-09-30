import { describe, expect, it } from 'vitest'
import type { SyncEnvelope } from '@tmarks/contracts'
import { listSyncChanges, pushSyncOperations } from '../src/lib/sync/sync'
import { emitSyncChange } from '../src/lib/sync/sync-emit'
import { createSqliteD1, type SqliteD1Harness } from './helpers/sqlite-d1'

const USER = 'user-1'
const DEVICE = 'device-a'

let counter = 0
function op(overrides: Partial<SyncEnvelope> & { payload: unknown }): SyncEnvelope {
  counter += 1
  return {
    client_operation_id: `op-${counter}`,
    device_id: DEVICE,
    entity_type: 'tab_group',
    operation: 'upsert',
    entity_id: 'g1',
    base_revision: null,
    created_at: new Date().toISOString(),
    ...overrides,
  } as SyncEnvelope
}

function itemRevision(h: SqliteD1Harness, itemId: string): string | undefined {
  const row = h.sqlite
    .prepare(
      "SELECT revision FROM sync_entity_revisions WHERE entity_type = 'tab_group_item' AND entity_id = ?"
    )
    .get(itemId) as { revision: string } | undefined
  return row?.revision
}

function groupRevision(h: SqliteD1Harness, groupId: string): string {
  return (h.sqlite.prepare('SELECT revision FROM tab_groups WHERE id = ?').get(groupId) as { revision: string }).revision
}

async function seedGroupWithItem(h: SqliteD1Harness) {
  await pushSyncOperations(h.db, USER, DEVICE, [
    op({
      entity_id: 'g1',
      payload: { title: 'G', tabs: [{ id: 'i1', title: 'Tab', url: 'https://a.example/', position: 0 }] },
    }),
  ])
}

/**
 * Tab group items travel inside their group's payload, so a group-level change
 * makes the client store the group's revision as each item's base_revision.
 * These tests pin the server to that same rule; when the two disagreed, an
 * ordinary edit sequence produced a conflict dialog with nothing to resolve.
 */
describe('tab group item revision ownership', () => {
  it('stamps items with the group revision on a group push', async () => {
    const h = createSqliteD1(USER)
    await seedGroupWithItem(h)

    expect(itemRevision(h, 'i1')).toBe(groupRevision(h, 'g1'))
    h.close()
  })

  it('stamps items with the group revision on a REST-side group change', async () => {
    const h = createSqliteD1(USER)
    await seedGroupWithItem(h)

    await emitSyncChange(h.db, USER, 'tab_group', 'g1', 'upsert')

    expect(itemRevision(h, 'i1')).toBe(groupRevision(h, 'g1'))
    h.close()
  })

  // Regression: edit an item on the extension, then edit the group on the web,
  // then edit that item again. Nothing genuinely conflicts, but the second item
  // push used to be rejected as revision_mismatch.
  it('accepts an item edit made after a group change on another device', async () => {
    const h = createSqliteD1(USER)
    await seedGroupWithItem(h)

    // Item edited on the extension, giving it an item-level revision.
    await pushSyncOperations(h.db, USER, DEVICE, [
      op({
        entity_type: 'tab_group_item',
        entity_id: 'i1',
        payload: { group_id: 'g1', title: 'Edited once', url: 'https://a.example/', position: 0 },
      }),
    ])

    // Group edited on the web; the client pulls that change and adopts its
    // revision as the base for every item in the group.
    await emitSyncChange(h.db, USER, 'tab_group', 'g1', 'upsert')
    const changes = await listSyncChanges(h.db, USER, null, 50)
    const groupChange = changes.changes[changes.changes.length - 1]
    expect(groupChange.entity_type).toBe('tab_group')

    const result = await pushSyncOperations(h.db, USER, DEVICE, [
      op({
        entity_type: 'tab_group_item',
        entity_id: 'i1',
        base_revision: groupChange.revision,
        payload: { group_id: 'g1', title: 'Edited twice', url: 'https://a.example/', position: 0 },
      }),
    ])

    expect(result.conflicts, 'nothing actually conflicted').toHaveLength(0)
    expect(result.rejected).toHaveLength(0)
    expect(result.accepted).toHaveLength(1)

    const row = h.sqlite.prepare('SELECT title FROM tab_group_items WHERE id = ?').get('i1') as { title: string }
    expect(row.title).toBe('Edited twice')
    h.close()
  })

  it('still raises a real conflict when the item genuinely moved on', async () => {
    const h = createSqliteD1(USER)
    await seedGroupWithItem(h)

    const stale = itemRevision(h, 'i1')

    // Another device edits the item, advancing its revision past `stale`.
    await pushSyncOperations(h.db, USER, 'device-b', [
      op({
        entity_type: 'tab_group_item',
        entity_id: 'i1',
        payload: { group_id: 'g1', title: 'From device B', url: 'https://a.example/', position: 0 },
      }),
    ])

    const result = await pushSyncOperations(h.db, USER, DEVICE, [
      op({
        entity_type: 'tab_group_item',
        entity_id: 'i1',
        base_revision: stale,
        payload: { group_id: 'g1', title: 'From device A', url: 'https://a.example/', position: 0 },
      }),
    ])

    expect(result.conflicts).toHaveLength(1)
    expect(result.conflicts[0].reason).toBe('revision_mismatch')
    h.close()
  })
})
