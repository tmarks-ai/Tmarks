import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SyncBootstrapResponse, SyncChangesResponse } from '@tmarks/contracts'
import { db } from '../src/lib/db'
import { apiClient } from '../src/lib/api/client'
import { bootstrapSync, pullChanges } from '../src/lib/sync/pull'

const emptyEntities: SyncBootstrapResponse['entities'] = {
  bookmarks: [],
  bookmark_folders: [],
  tags: [],
  tab_groups: [],
  tab_group_items: [],
  preferences: [],
}

function bootstrapPage(overrides: Partial<SyncBootstrapResponse> = {}): SyncBootstrapResponse {
  return {
    cursor: 'cursor-1',
    server_time: '2024-01-01T00:00:00.000Z',
    has_more: false,
    entities: emptyEntities,
    ...overrides,
  }
}

function changesPage(overrides: Partial<SyncChangesResponse> = {}): SyncChangesResponse {
  return {
    cursor: 'cursor-1',
    has_more: false,
    changes: [],
    ...overrides,
  }
}

async function reset() {
  await db.transaction('rw', [db.bookmarks, db.folders, db.tags, db.tabGroups, db.tabGroupItems, db.syncState], async () => {
    await Promise.all([
      db.bookmarks.clear(),
      db.folders.clear(),
      db.tags.clear(),
      db.tabGroups.clear(),
      db.tabGroupItems.clear(),
      db.syncState.clear(),
    ])
  })
}

beforeEach(reset)
afterEach(() => {
  vi.restoreAllMocks()
  return reset()
})

describe('sync pagination fail-closed behavior', () => {
  it('rejects a bootstrap page with has_more=true but no page_cursor', async () => {
    vi.spyOn(apiClient, 'get').mockResolvedValue({
      data: bootstrapPage({ has_more: true }),
    } as never)

    await expect(bootstrapSync()).rejects.toThrow('page_cursor')
    expect(await db.syncState.get('singleton')).toBeUndefined()
  })

  it('does not reconcile or mark bootstrap complete when pagination fails', async () => {
    await db.bookmarks.put({
      id: 'local-only',
      title: 'Keep me',
      url: 'https://example.com/keep',
      dirty_fields: [],
      pending_op: null,
    } as never)
    vi.spyOn(apiClient, 'get')
      .mockResolvedValueOnce({ data: bootstrapPage({ has_more: true, page_cursor: 'page-1' }) } as never)
      .mockRejectedValueOnce(new Error('network down'))

    await expect(bootstrapSync()).rejects.toThrow('network down')
    expect(await db.bookmarks.get('local-only')).toBeTruthy()
    expect((await db.syncState.get('singleton'))?.last_bootstrap_at ?? null).toBeNull()
  })

  it('rejects bootstrap after the page limit instead of reconciling', async () => {
    vi.spyOn(apiClient, 'get').mockImplementation(async () => ({
      data: bootstrapPage({
        has_more: true,
        page_cursor: 'next-page',
        cursor: 'cursor-1',
      }),
    }) as never)

    await expect(bootstrapSync()).rejects.toThrow('200 pages')
    expect(vi.mocked(apiClient.get)).toHaveBeenCalledTimes(200)
    expect((await db.syncState.get('singleton'))?.last_bootstrap_at ?? null).toBeNull()
  })

  it('rejects incremental pull at the page limit and leaves sync incomplete', async () => {
    vi.spyOn(apiClient, 'get').mockImplementation(async () => ({
      data: changesPage({ has_more: true, cursor: 'cursor-1' }),
    }) as never)

    await expect(pullChanges()).rejects.toThrow('100 pages')
    expect(vi.mocked(apiClient.get)).toHaveBeenCalledTimes(100)
    const state = await db.syncState.get('singleton')
    expect(state?.cursor).toBe('cursor-1')
    expect(state?.last_sync_at ?? null).toBeNull()
  })
})
