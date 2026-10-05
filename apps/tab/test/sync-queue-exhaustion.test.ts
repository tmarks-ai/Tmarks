import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { SyncPushResponse } from '@tmarks/contracts'
import { db } from '../src/lib/db'
import { enqueueSyncOperation, markFailed, takePendingBatch } from '../src/lib/db/queue'
import { applyPushResponse } from '../src/lib/db/queue-apply'

async function clearQueue(): Promise<void> {
  await db.syncQueue.clear()
  await db.bookmarks.clear()
}

beforeEach(clearQueue)
afterEach(clearQueue)

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

function rejection(clientOperationId: string, code: string): SyncPushResponse {
  return {
    accepted: [],
    conflicts: [],
    rejected: [{ client_operation_id: clientOperationId, entity_type: 'bookmark', entity_id: 'bm-1', code, message: code }],
    cursor: '',
  } as unknown as SyncPushResponse
}

describe('sync queue retry exhaustion', () => {
  // Regression: a rejection the server can never accept was retried hourly
  // forever. The entity stayed dirty, and pull skips dirty entities, so it fell
  // out of sync in both directions.
  it('marks a terminally rejected operation exhausted on the first response', async () => {
    const item = await enqueueBookmark('bm-1')

    await applyPushResponse([item], rejection(item.client_operation_id, 'DUPLICATE_URL'))

    const stored = await db.syncQueue.get(item.id)
    expect(stored?.status).toBe('exhausted')
    expect(stored?.next_retry_at).toBeNull()
    expect(await takePendingBatch(10)).toHaveLength(0)
  })

  it('still retries an unrecognized rejection code that might succeed later, with backoff', async () => {
    const item = await enqueueBookmark('bm-1')

    // R8 BR-3/CA-2 made RESOURCE_LOCKED terminal (a locked group can never be
    // re-pushed into place, and it now arrives with server_payload for the
    // "accept remote" recovery). The conservative DEFAULT for codes in
    // neither set — e.g. a future server addition — stays: burn one retry
    // with backoff, like any transient business rejection.
    await applyPushResponse([item], rejection(item.client_operation_id, 'UNRECOGNIZED_SERVER_CODE'))

    const stored = await db.syncQueue.get(item.id)
    expect(stored?.status).toBe('failed')
    expect(stored?.retry_count).toBe(1)
    expect(stored?.next_retry_at).not.toBeNull()
  })

  it('treats a locked-group rejection as terminal now that the sync face enforces locks (R8 BR-3/CA-2)', async () => {
    const item = await enqueueBookmark('bm-1')

    await applyPushResponse([item], rejection(item.client_operation_id, 'RESOURCE_LOCKED'))

    const stored = await db.syncQueue.get(item.id)
    expect(stored?.status).toBe('exhausted')
    expect(stored?.next_retry_at).toBeNull()
    expect(await takePendingBatch(10)).toHaveLength(0)
  })

  // R5-10 regression: the backend delivers config-class rejections INSIDE a
  // 200 push body's rejected[]; this loop previously burned one retry per
  // collision (markFailed's non-burning semantics were not applied here), so
  // 8 IDEMPOTENCY_IN_PROGRESS collisions dead-lettered the op as 'exhausted'
  // in exactly the engineered scenario — re-pushing a placeholder another
  // concurrent push had claimed.
  it('does not burn the retry budget for non-burning codes on the rejected-in-200 path (R5-10)', async () => {
    for (const code of ['FORBIDDEN', 'ORIGIN_UNSET', 'RATE_LIMITED', 'QUOTA_EXCEEDED', 'IDEMPOTENCY_IN_PROGRESS']) {
      await clearQueue()
      const item = await enqueueBookmark('bm-1')
      await db.syncQueue.update(item.id, { retry_count: 7 })
      const current = await db.syncQueue.get(item.id)

      await applyPushResponse([current!], rejection(current!.client_operation_id, code))

      const stored = await db.syncQueue.get(item.id)
      expect(stored?.status, code).toBe('failed')
      expect(stored?.retry_count, code).toBe(7)
      // No backoff: immediately due for the next drain once the condition clears.
      expect(stored?.next_retry_at, code).toBeNull()
      expect(await takePendingBatch(10), code).toHaveLength(1)
    }
  })

  it('gives up on a transient failure after the retry budget runs out', async () => {
    const item = await enqueueBookmark('bm-1')
    await db.syncQueue.update(item.id, { retry_count: 7 })
    const current = await db.syncQueue.get(item.id)

    await markFailed([current!], 'NETWORK_ERROR', 'offline')

    const stored = await db.syncQueue.get(item.id)
    expect(stored?.status).toBe('exhausted')
    expect(await takePendingBatch(10)).toHaveLength(0)
  })

  // Regression: a stale API key or unconfigured origin kept being retried by the
  // 5-minute drain, burning the 8-retry budget in ~40 minutes and dead-lettering
  // the whole queue. Config-class errors must not count toward the budget.
  it('does not burn the retry budget on config-class errors (forbidden / unset origin / rate limit / quota)', async () => {
    const item = await enqueueBookmark('bm-1')
    await db.syncQueue.update(item.id, { retry_count: 7 })

    for (const code of ['FORBIDDEN', 'ORIGIN_UNSET', 'RATE_LIMITED', 'QUOTA_EXCEEDED', 'IDEMPOTENCY_IN_PROGRESS']) {
      const current = await db.syncQueue.get(item.id)
      await markFailed([current!], code, code)
      const stored = await db.syncQueue.get(item.id)
      expect(stored?.status, code).toBe('failed')
      expect(stored?.retry_count, code).toBe(7)
    }

    // 保持 failed 且立即可重试:修好凭据后下一轮排空自动恢复。
    const stored = await db.syncQueue.get(item.id)
    expect(stored?.next_retry_at).toBeNull()
    expect(await takePendingBatch(10)).toHaveLength(1)
  })

  it('revives an exhausted operation when the user edits the entity again', async () => {
    const item = await enqueueBookmark('bm-1')
    await applyPushResponse([item], rejection(item.client_operation_id, 'DUPLICATE_URL'))
    expect((await db.syncQueue.get(item.id))?.status).toBe('exhausted')

    await enqueueSyncOperation({
      entityType: 'bookmark',
      entityId: 'bm-1',
      operation: 'upsert',
      baseRevision: null,
      payload: { title: 'Corrected', url: 'https://example.com/corrected' },
      dirtyFields: ['title', 'url'],
    })

    const stored = await db.syncQueue.get(item.id)
    expect(stored?.status).toBe('pending')
    expect(await takePendingBatch(10)).toHaveLength(1)
  })

  it('does not let one exhausted operation block unrelated pending ones', async () => {
    const blocked = await enqueueBookmark('bm-1')
    await applyPushResponse([blocked], rejection(blocked.client_operation_id, 'VALIDATION_FAILED'))

    await enqueueBookmark('bm-2')

    const due = await takePendingBatch(10)
    expect(due.map((row) => row.entity_id)).toEqual(['bm-2'])
  })
})
