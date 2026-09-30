import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { SyncChange } from '@tmarks/contracts'
import { db } from '../src/lib/db'
import { applyChange } from '../src/lib/sync/pull'

/**
 * Consumer half of the sync chain.
 *
 * The payload shapes below are exactly what the server emits — verified against
 * the real D1 schema in packages/backend-core/test/sync-emit.test.ts. These
 * tests assert the extension actually acts on them, which is where a break
 * between the two halves would otherwise hide until a user noticed stale data.
 */

async function reset() {
  await db.bookmarks.clear()
  await db.folders.clear()
  await db.tags.clear()
  await db.tabGroups.clear()
  await db.tabGroupItems.clear()
}

beforeEach(reset)
afterEach(reset)

function change(overrides: Partial<SyncChange>): SyncChange {
  return {
    change_id: 'c1',
    entity_type: 'bookmark',
    entity_id: 'b1',
    operation: 'upsert',
    revision: 'rev-1',
    payload: {},
    changed_at: '2024-01-01T00:00:00.000Z',
    ...overrides,
  } as SyncChange
}

describe('pull applies server changes', () => {
  it('creates a bookmark from a REST-emitted upsert', async () => {
    await applyChange(change({
      entity_id: 'b1',
      operation: 'upsert',
      payload: { id: 'b1', title: 'From web', url: 'https://a.example/', deleted_at: null },
    }))

    const row = await db.bookmarks.get('b1')
    expect(row?.title).toBe('From web')
    expect(row?.base_revision).toBe('rev-1')
    expect(row?.dirty_fields).toEqual([])
  })

  // A hard delete (permanent delete / empty trash) has no row left to serialize,
  // so the server sends payload: null. The delete must still be applied.
  it('applies a tombstone whose payload is null', async () => {
    await db.bookmarks.put({ id: 'b1', title: 'Doomed', url: 'https://a.example/', dirty_fields: [], pending_op: null } as never)

    await applyChange(change({ entity_id: 'b1', operation: 'delete', payload: null }))

    expect(await db.bookmarks.get('b1')).toBeUndefined()
  })

  it('removes a bookmark trashed on the web', async () => {
    await db.bookmarks.put({ id: 'b1', title: 'Trashed', url: 'https://a.example/', dirty_fields: [], pending_op: null } as never)

    await applyChange(change({
      entity_id: 'b1',
      operation: 'delete',
      payload: { id: 'b1', title: 'Trashed', url: 'https://a.example/', deleted_at: '2024-01-01T00:00:00.000Z' },
    }))

    expect(await db.bookmarks.get('b1')).toBeUndefined()
  })

  it('never overwrites a locally edited bookmark', async () => {
    await db.bookmarks.put({ id: 'b1', title: 'My edit', url: 'https://a.example/', dirty_fields: ['title'], pending_op: 'upsert' } as never)

    await applyChange(change({
      entity_id: 'b1',
      operation: 'upsert',
      payload: { id: 'b1', title: 'Server version', url: 'https://a.example/' },
    }))

    expect((await db.bookmarks.get('b1'))?.title).toBe('My edit')
  })

  it('carries tab group items embedded in the group payload', async () => {
    await applyChange(change({
      entity_type: 'tab_group',
      entity_id: 'g1',
      operation: 'upsert',
      payload: {
        id: 'g1',
        title: 'Group',
        tabs: [
          { id: 'i1', group_id: 'g1', title: 'Tab 1', url: 'https://a.example/', position: 0 },
          { id: 'i2', group_id: 'g1', title: 'Tab 2', url: 'https://b.example/', position: 1 },
        ],
      },
    }))

    expect(await db.tabGroupItems.where('group_id').equals('g1').count()).toBe(2)
  })

  // Regression: item mutations are broadcast as a group-level upsert whose
  // payload embeds the authoritative tab list. Removing the *last* tab produces
  // `tabs: []`, which the apply path treated as "no information" and skipped —
  // leaving the deleted tab on every other device until the 24h bootstrap.
  it('clears tabs when the last one is removed on another device', async () => {
    await applyChange(change({
      entity_type: 'tab_group',
      entity_id: 'g1',
      operation: 'upsert',
      payload: { id: 'g1', title: 'Group', tabs: [{ id: 'i1', group_id: 'g1', title: 'Tab 1', url: 'https://a.example/', position: 0 }] },
    }))
    expect(await db.tabGroupItems.where('group_id').equals('g1').count()).toBe(1)

    await applyChange(change({
      entity_type: 'tab_group',
      entity_id: 'g1',
      operation: 'upsert',
      revision: 'rev-2',
      payload: { id: 'g1', title: 'Group', tabs: [] },
    }))

    expect(await db.tabGroupItems.where('group_id').equals('g1').count()).toBe(0)
  })

  it('keeps a locally edited tab when the group is emptied remotely', async () => {
    await db.tabGroups.put({ id: 'g1', title: 'Group', item_count: 1, dirty_fields: [], pending_op: null } as never)
    await db.tabGroupItems.put({ id: 'i1', group_id: 'g1', title: 'My edit', url: 'https://a.example/', position: 0, dirty_fields: ['title'], pending_op: 'upsert' } as never)

    await applyChange(change({
      entity_type: 'tab_group',
      entity_id: 'g1',
      operation: 'upsert',
      payload: { id: 'g1', title: 'Group', tabs: [] },
    }))

    expect(await db.tabGroupItems.get('i1')).toBeTruthy()
  })
})
