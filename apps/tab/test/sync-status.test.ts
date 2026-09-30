import Dexie from 'dexie'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TMarkDB } from '../src/lib/db'
import { handleGetSyncStatus } from '../src/lib/sync/sync-status'

const databaseNames: string[] = []

afterEach(async () => {
  await Promise.all(databaseNames.splice(0).map((name) => Dexie.delete(name)))
})

function uniqueName(): string {
  return `tmark-sync-status-${crypto.randomUUID()}`
}

type HandlerSender = { id?: string; tab?: unknown }
type HandlerMessage = { type: string }

/**
 * 提取与 apps/tab/src/background/index.ts 相同的 sender-gate 逻辑,
 * 使单测能直接覆盖 "sender.id !== chrome.runtime.id → return false" 分支,
 * 而不必拉起整个 background service worker(它依赖大量 chrome.* API)。
 */
function createGatedHandler(opts: {
  db: TMarkDB
  chromeId: string
}) {
  return (msg: HandlerMessage, sender: HandlerSender, sendResponse: (v: unknown) => void): boolean => {
    // 与 background 完全一致的守卫顺序
    if (sender.id !== opts.chromeId || sender.tab) return false
    if (msg?.type === 'GET_SYNC_STATUS') {
      void (async () => {
        try {
          sendResponse(await handleGetSyncStatus(opts.db))
        } catch (e) {
          sendResponse({ ok: false, error: e instanceof Error ? e.message : 'failed' })
        }
      })()
      return true
    }
    return false
  }
}

describe('GET_SYNC_STATUS background handler', () => {
  let db: TMarkDB

  beforeEach(async () => {
    const name = uniqueName()
    databaseNames.push(name)
    db = new TMarkDB(name)
    await db.open()
  })

  it('rejects senders whose id differs from chrome.runtime.id', async () => {
    const handler = createGatedHandler({ db, chromeId: 'self-id' })
    const sendResponse = vi.fn()

    const ret1 = handler({ type: 'GET_SYNC_STATUS' }, { id: 'other-ext' }, sendResponse)
    expect(ret1).toBe(false)

    // content script 携带 tab 引用,同样被拒
    const ret2 = handler({ type: 'GET_SYNC_STATUS' }, { id: 'self-id', tab: { id: 1 } }, sendResponse)
    expect(ret2).toBe(false)
    expect(sendResponse).not.toHaveBeenCalled()
    await db.close()
  })

  it('returns counts/mode/pendingOps from stubbed data when sender is the extension itself', async () => {
    // 预制数据:2 bookmarks / 1 folder / 3 tags / 1 tabGroup / 2 tabGroupItems;
    // syncState mode = cloud_sync, last_sync_at 固定;队列 2 pending + 1 synced(不计入 pendingOps)
    const now = '2026-08-05T00:00:00.000Z'
    await db.bookmarks.bulkAdd([
      { id: 'b1', base_revision: null, dirty_fields: [], pending_op: null } as never,
      { id: 'b2', base_revision: null, dirty_fields: [], pending_op: null } as never,
    ])
    await db.folders.add({ id: 'f1', base_revision: null, dirty_fields: [], pending_op: null } as never)
    await db.tags.bulkAdd([
      { id: 't1', base_revision: null, dirty_fields: [], pending_op: null } as never,
      { id: 't2', base_revision: null, dirty_fields: [], pending_op: null } as never,
      { id: 't3', base_revision: null, dirty_fields: [], pending_op: null } as never,
    ])
    await db.tabGroups.add({ id: 'g1', base_revision: null, dirty_fields: [], pending_op: null } as never)
    await db.tabGroupItems.bulkAdd([
      { id: 'i1', group_id: 'g1', base_revision: null, dirty_fields: [], pending_op: null } as never,
      { id: 'i2', group_id: 'g1', base_revision: null, dirty_fields: [], pending_op: null } as never,
    ])
    await db.syncState.put({ id: 'singleton', cursor: 'c-1', mode: 'cloud_sync', last_sync_at: now, last_bootstrap_at: now })
    await db.syncQueue.bulkAdd([
      queueRecord({ id: 'q1', status: 'pending' }),
      queueRecord({ id: 'q2', status: 'pending' }),
      queueRecord({ id: 'q3', status: 'synced' }),
    ])

    const handler = createGatedHandler({ db, chromeId: 'self-id' })
    const sendResponse = vi.fn()
    const ret = handler({ type: 'GET_SYNC_STATUS' }, { id: 'self-id' }, sendResponse)
    expect(ret).toBe(true)

    // 等一个 microtask 让 async sendResponse 完成
    await vi.waitUntil(() => sendResponse.mock.calls.length > 0, { timeout: 500 })
    const payload = sendResponse.mock.calls[0][0] as { ok: true; data: Record<string, unknown> }
    expect(payload.ok).toBe(true)
    expect(payload.data).toMatchObject({
      syncMode: 'cloud_sync',
      pendingOps: 2,
      lastSyncAt: now,
      counts: {
        bookmarks: 2,
        folders: 1,
        tags: 3,
        tabGroups: 1,
        tabGroupItems: 2,
      },
    })
    await db.close()
  })
})

function queueRecord(over: Partial<{ id: string; status: 'pending' | 'synced' }>) {
  const ts = '2026-08-05T00:00:00.000Z'
  return {
    id: over.id ?? crypto.randomUUID(),
    client_operation_id: `d:${crypto.randomUUID()}`,
    device_id: 'dev-1',
    entity_type: 'bookmark' as const,
    entity_id: 'b1',
    operation: 'upsert' as const,
    base_revision: null,
    payload: {},
    dirty_fields: [],
    sync_generation: 0,
    status: over.status ?? ('pending' as const),
    retry_count: 0,
    next_retry_at: null,
    error_code: null,
    error_message: null,
    created_at: ts,
    updated_at: ts,
  }
}
