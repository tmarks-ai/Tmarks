import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../src/lib/db'
import { apiClient } from '../src/lib/api/client'
import { pushDirty } from '../src/lib/sync/push'
import { enqueueSyncOperation } from '../src/lib/db/queue'

/**
 * R5-11 regression: the 5-minute queue-drain alarm calls pushDirty directly,
 * outside runSync's inFlight mutex. Two overlapping pushes each ran the entry/
 * exit resetStrandedSyncingRows, trampled each other's 'syncing' marks and
 * double-pushed the same rows into IDEMPOTENCY_IN_PROGRESS rejections.
 * pushDirty now shares one in-flight run across concurrent callers (module
 * mutex, mirroring runSync); a caller that lands mid-run joins its result.
 */
async function clearQueue(): Promise<void> {
  await db.syncQueue.clear()
  await db.bookmarks.clear()
}

beforeEach(clearQueue)
afterEach(() => {
  vi.restoreAllMocks()
  return clearQueue()
})

async function enqueueBookmark(entityId: string) {
  return enqueueSyncOperation({
    entityType: 'bookmark',
    entityId,
    operation: 'upsert',
    baseRevision: null,
    payload: { title: 'T', url: `https://example.com/${entityId}` },
    dirtyFields: ['title'],
  })
}

describe('pushDirty in-flight mutex (R5-11)', () => {
  it('concurrent callers join the same in-flight push instead of racing it', async () => {
    await enqueueBookmark('bm-1')
    let release!: (value: unknown) => void
    vi.spyOn(apiClient, 'post').mockImplementation(
      () => new Promise((resolve) => { release = resolve }) as never,
    )

    const first = pushDirty()
    // While the first push hangs on the network, a second caller (the
    // queue-drain alarm) must join the SAME run — pre-fix it started a
    // second push that reset the rows the first had just marked 'syncing'.
    const second = pushDirty()
    expect(second).toBe(first)

    // Let the in-flight run advance to the network before asserting the call
    // count (the sync-queue steps before sendBatch are all async).
    for (let i = 0; i < 100 && vi.mocked(apiClient.post).mock.calls.length === 0; i++) {
      await new Promise((resolve) => setTimeout(resolve, 1))
    }
    expect(apiClient.post).toHaveBeenCalledTimes(1)

    release({ data: { accepted: [], conflicts: [], rejected: [], cursor: '' } })
    const result = await second
    expect(result.accepted).toBe(0)

    // After the run settles, the lock is cleared: a new call starts a fresh
    // push rather than joining a dead promise. Switch the SAME spy's behavior
    // (re-spying would re-wrap the unmocked method).
    vi.mocked(apiClient.post).mockResolvedValue({
      data: { accepted: [], conflicts: [], rejected: [], cursor: '' },
    } as never)
    const third = pushDirty()
    expect(third).not.toBe(first)
    await third
    expect(apiClient.post).toHaveBeenCalledTimes(2)
  })
})
