import type {
  DeviceId,
  EntityId,
  Revision,
  SyncEnvelope,
  SyncOperationType,
} from '@tmarks/contracts'
import { db, type SyncQueueRecord } from './index'
import { getOrCreateDeviceId } from './sync-state'
import { isNonBurningSyncErrorCode } from './queue-errors'

export type SyncEntityType = 'tab_group' | 'tab_group_item' | 'bookmark' | 'bookmark_folder' | 'tag'

/** Give up after this many transient failures rather than retrying hourly forever. */
export const MAX_SYNC_RETRIES = 8

interface EnqueueSyncOperationInput {
  entityType: SyncEntityType
  entityId: EntityId
  operation: SyncOperationType
  baseRevision: Revision | null
  payload: unknown
  dirtyFields?: string[]
}

/** 入队一条同步操作(幂等:`entity_type:entity_id:operation` 已有 pending/failed 项则更新 payload,不新建)。 */
export async function enqueueSyncOperation(input: EnqueueSyncOperationInput): Promise<SyncQueueRecord> {
  const deviceId = await getOrCreateDeviceId()
  const now = new Date().toISOString()
  const dirtyFields = input.dirtyFields ?? await getEntityDirtyFields(input.entityType, input.entityId)
  const existing = await db.syncQueue
    .where('[entity_type+entity_id+operation]')
    .equals([input.entityType, input.entityId, input.operation])
    .and((r) => r.status !== 'synced')
    .first()

  if (existing) {
    const nextDirtyFields = [...(input.dirtyFields ?? dirtyFields)]
    const sameSnapshot = JSON.stringify(existing.payload) === JSON.stringify(input.payload)
      && existing.base_revision === input.baseRevision
      && JSON.stringify(existing.dirty_fields ?? []) === JSON.stringify(nextDirtyFields)
    const nextGeneration = sameSnapshot ? existing.sync_generation : existing.sync_generation + 1
    // 旧 server_payload 属于上次冲突时的服务端版本,与新载荷已不对应——一并
    // 清空,防"接受远端"在普通失败态上凭空出现并应用过期版本。
    const updated: Partial<SyncQueueRecord> = {
      client_operation_id: sameSnapshot ? existing.client_operation_id : `${deviceId}:${crypto.randomUUID()}`,
      payload: input.payload,
      base_revision: input.baseRevision,
      dirty_fields: nextDirtyFields,
      sync_generation: nextGeneration,
      status: 'pending',
      next_retry_at: null,
      error_code: null,
      error_message: null,
      server_payload: null,
      server_revision: null,
      updated_at: now,
    }
    await db.syncQueue.update(existing.id, updated)
    return { ...existing, ...updated } as SyncQueueRecord
  }

  const record: SyncQueueRecord = {
    id: crypto.randomUUID(),
    client_operation_id: `${deviceId}:${crypto.randomUUID()}`,
    device_id: deviceId,
    entity_type: input.entityType,
    entity_id: input.entityId,
    operation: input.operation,
    base_revision: input.baseRevision,
    payload: input.payload,
    dirty_fields: dirtyFields,
    sync_generation: 0,
    status: 'pending',
    retry_count: 0,
    next_retry_at: null,
    error_code: null,
    error_message: null,
    created_at: now,
    updated_at: now,
  }
  await db.syncQueue.add(record)
  return record
}

export async function getEntityDirtyFields(entityType: SyncEntityType, entityId: EntityId): Promise<string[]> {
  const row = entityType === 'bookmark'
    ? await db.bookmarks.get(entityId)
    : entityType === 'bookmark_folder'
      ? await db.folders.get(entityId)
      : entityType === 'tag'
        ? await db.tags.get(entityId)
        : entityType === 'tab_group'
          ? await db.tabGroups.get(entityId)
          : await db.tabGroupItems.get(entityId)
  return Array.isArray(row?.dirty_fields) ? [...row.dirty_fields] : []
}
/** 取一批待 push 的队列项(pending 或 failed 且已过退避时间),按实体优先级排序。 */
export async function takePendingBatch(batchSize: number): Promise<SyncQueueRecord[]> {
  const nowIso = new Date().toISOString()
  const candidates = await db.syncQueue
    .where('status')
    .anyOf(['pending', 'failed'])
    .toArray()
  const due = candidates.filter((r) => r.status === 'pending' || !r.next_retry_at || r.next_retry_at <= nowIso)
  due.sort(compareSyncQueueItems)
  return due.slice(0, batchSize)
}

export async function markSyncing(items: SyncQueueRecord[]): Promise<void> {
  const ts = new Date().toISOString()
  await db.transaction('rw', db.syncQueue, async () => {
    await Promise.all(items.map((r) => db.syncQueue.update(r.id, { status: 'syncing', updated_at: ts })))
  })
}

export async function markFailed(items: SyncQueueRecord[], code: string, message: string): Promise<void> {
  const ts = new Date().toISOString()
  await db.transaction('rw', db.syncQueue, async () => {
    await Promise.all(items.map(async (item) => {
      if (!(await isCurrentQueueSnapshot(item))) return
      // failed/exhausted 态不携带冲突载荷(server_payload 由 applyPushResponse
      // 单独写;残留让"接受远端"出现在普通失败态上并应用过期版本)。
      const clearServerPayload = { server_payload: null, server_revision: null }
      if (isNonBurningSyncErrorCode(code)) {
        await db.syncQueue.update(item.id, {
          status: 'failed',
          retry_count: item.retry_count,
          next_retry_at: null,
          error_code: code,
          error_message: message,
          ...clearServerPayload,
          updated_at: ts,
        })
        return
      }
      const retryCount = item.retry_count + 1
      const exhausted = retryCount >= MAX_SYNC_RETRIES
      await db.syncQueue.update(item.id, {
        status: exhausted ? 'exhausted' : 'failed',
        retry_count: retryCount,
        next_retry_at: exhausted ? null : nextRetryAt(retryCount),
        error_code: code,
        error_message: message,
        ...clearServerPayload,
        updated_at: ts,
      })
    }))
  })
}

/** 应用 push 响应的逻辑拆至 queue-apply.ts(300 行门禁);importer 直接从那里取 applyPushResponse。 */

/** 队列项 → SyncEnvelope(对齐 contracts;entity_id 用队列快照的本地 id)。 */
export function toEnvelope(item: SyncQueueRecord): SyncEnvelope {
  return {
    client_operation_id: item.client_operation_id,
    device_id: item.device_id as DeviceId,
    entity_type: item.entity_type,
    entity_id: item.entity_id,
    operation: item.operation,
    base_revision: item.base_revision,
    payload: item.payload,
    created_at: item.created_at,
  }
}

/** 实体优先级:folder< tag< bookmark< tab_group< tab_group_item(父先于子)。 */
function compareSyncQueueItems(a: SyncQueueRecord, b: SyncQueueRecord): number {
  const pa = syncEntityPriority(a.entity_type)
  const pb = syncEntityPriority(b.entity_type)
  if (pa !== pb) return pa - pb
  return a.created_at.localeCompare(b.created_at)
}

export function syncKey(entityType: SyncEntityType, entityId: EntityId, operation: SyncOperationType): string {
  return `${entityType}:${entityId}:${operation}`
}

function syncEntityPriority(entityType: SyncEntityType): number {
  switch (entityType) {
    case 'bookmark_folder': return 10
    case 'tag': return 20
    case 'bookmark': return 30
    case 'tab_group': return 40
    case 'tab_group_item': return 50
  }
}

/** 指数退避:2^n * 1s,上限 1h。 */
export function nextRetryAt(retryCount: number): string {
  const delayMs = Math.min(60 * 60 * 1000, 2 ** retryCount * 1000)
  return new Date(Date.now() + delayMs).toISOString()
}

export async function isCurrentQueueSnapshot(item: SyncQueueRecord): Promise<boolean> {
  const current = await db.syncQueue.get(item.id)
  return current?.client_operation_id === item.client_operation_id
    && current.sync_generation === item.sync_generation
}
