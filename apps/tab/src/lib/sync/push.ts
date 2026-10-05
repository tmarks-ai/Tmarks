import type { DeviceId, SyncPushResponse } from '@tmarks/contracts'
import { apiClient, unwrapData } from '../api/client'
import { db, ACCEPT_REMOTE_TRANSACTION_TABLES, type SyncQueueRecord, type LocalBookmark, type LocalFolder, type LocalTag, type LocalTabGroup, type LocalTabGroupItem } from '../db'
import { getOrCreateDeviceId } from '../db/sync-state'
import { normalizeBookmarkRow, normalizeFolderRow, normalizeTabGroupItemRow, normalizeTabGroupRow, normalizeTagRow } from './normalize'
import { takePendingBatch, markSyncing, markFailed, toEnvelope } from '../db/queue'
import { applyPushResponse } from '../db/queue-apply'
import { resetStrandedSyncingRows } from '../db/queue-repair'
import { logOperation } from '../db/operation-logs'
import { classifyPushError, type PushBatchFailure } from './push-errors'

const CHUNK_SIZE = 50

export interface PushResult {
  accepted: number
  conflicts: number
  rejected: number
  quotaExceeded: boolean
  forbidden: boolean
  networkErrors: number
}

// R5-11: the 5-minute queue-drain alarm calls pushDirty directly, OUTSIDE
// runSync's inFlight mutex — two overlapping pushes each ran the entry/exit
// resetStrandedSyncingRows and trampled each other's 'syncing' marks, then
// double-pushed the same rows into IDEMPOTENCY_IN_PROGRESS rejections (which
// the queue then burned retries on). Concurrent callers now share one
// in-flight run, mirroring runSync's module mutex; a caller that lands here
// while a push is running joins its result instead of starting a second one.
let pushInFlight: Promise<PushResult> | null = null

/** Push pending sync operations through the canonical API. */
export function pushDirty(): Promise<PushResult> {
  if (pushInFlight) return pushInFlight
  pushInFlight = pushDirtyGuarded()
  return pushInFlight
}

async function pushDirtyGuarded(): Promise<PushResult> {
  try {
    return await pushDirtyOnce()
  } finally {
    pushInFlight = null
  }
}

async function pushDirtyOnce(): Promise<PushResult> {
  await getOrCreateDeviceId()
  // 入口自愈:复位上一次异常退出残留的 'syncing' 行。runSync 的 inFlight
  // 互斥 + pushDirty 自身的共享互斥保证此刻没有并行推送,复位是安全的
  // (此前只有 SW 冷启动会做)。
  await resetStrandedSyncingRows()
  try {
    return await pushDirtyInner()
  } finally {
    // 收尾自愈:quota 减半回退会先把整个宽批次标成 'syncing',重试切片
    // 变窄后,落在切片外的行在 break 时无人接手——不复位就永久滞留,
    // takePendingBatch 不再拾取 'syncing'。重推有服务端幂等键兜底。
    await resetStrandedSyncingRows().catch(() => {})
  }
}

async function pushDirtyInner(): Promise<PushResult> {
  const remaining = await takePendingBatch(Number.MAX_SAFE_INTEGER)
  if (remaining.length === 0) return { accepted: 0, conflicts: 0, rejected: 0, quotaExceeded: false, forbidden: false, networkErrors: 0 }

  let chunk = CHUNK_SIZE
  let accepted = 0, conflicts = 0, rejected = 0, networkErrors = 0
  let quotaExceeded = false, forbidden = false

  for (let i = 0; i < remaining.length; i += chunk) {
    const batch = remaining.slice(i, i + chunk)
    await markSyncing(batch)
    const res = await sendBatch(batch.map(toEnvelope))
    if (res.kind === 'quota') {
      quotaExceeded = true
      if (chunk > 1) { chunk = Math.max(1, Math.floor(chunk / 2)); i -= chunk; continue }
      await markFailed(batch, 'QUOTA_EXCEEDED', 'Sync batch quota exceeded')
      break
    }
    if (res.kind === 'forbidden') {
      forbidden = true
      await markFailed(batch, 'FORBIDDEN', 'Sync permission is required')
      break
    }
    if (res.kind === 'originUnset') {
      await markFailed(batch, 'ORIGIN_UNSET', res.message)
      break
    }
    if (res.kind === 'network') {
      await markFailed(batch, 'NETWORK_ERROR', res.message)
      networkErrors += batch.length
      continue
    }
    if (res.kind === 'rateLimited') {
      // 服务端限流:停止本轮推送,留退避下次再推。此前落入 network 分支
      // 会继续烧下一个 chunk 的重试计数,一次性打满 8 次 → exhausted。
      await markFailed(batch, 'RATE_LIMITED', res.message)
      break
    }
    if (res.kind === 'serverError') {
      // 服务端 5xx(如免费版 D1 预算超限):外部状态故障,不烧重试预算
      // (SERVER_ERROR 在 NON_BURNING_ERROR_CODES 里),停止本轮排空,
      // 下轮排空自动重试——烧预算会把确定性 500 在 ~40 分钟内打成死信。
      await markFailed(batch, 'SERVER_ERROR', res.message)
      break
    }
    const applied = await applyPushResponse(batch, res.value)
    accepted += applied.accepted
    conflicts += applied.conflicts
    rejected += applied.rejected
  }
  return { accepted, conflicts, rejected, quotaExceeded, forbidden, networkErrors }
}

type BatchResult =
  | { kind: 'ok'; value: SyncPushResponse }
  | PushBatchFailure

async function sendBatch(operations: ReturnType<typeof toEnvelope>[]): Promise<BatchResult> {
  const deviceId = operations[0]?.device_id as DeviceId
  try {
    const value = await unwrapData(await apiClient.post<SyncPushResponse>('/api/v1/sync/push', { device_id: deviceId, operations }), 'POST /api/v1/sync/push')
    return { kind: 'ok', value }
  } catch (e) {
    return classifyPushError(e as { code?: string; status?: number; message?: string })
  }
}

export async function retrySyncQueueItem(id: string): Promise<void> {
  const ts = new Date().toISOString()
  // 仅对非 syncing 行开放重试:在途行的响应回写按 client_operation_id+
  // sync_generation 校验,重置 syncing 行会被在途响应覆盖/删除。
  const item = await db.syncQueue.get(id)
  if (!item || item.status === 'syncing') return
  // R8 TA-5: rows that carry a server_payload were already answered by the
  // server — the server replays the stored response by (user, op id), so
  // retrying the SAME id is an idempotent no-op loop. Rotate the id (the
  // force-local pattern) so the retry is a genuinely fresh push. Rows with
  // no server_payload (transport failures) keep the id: the idempotency key
  // is what prevents a double-apply once the retry lands.
  const alreadyAnswered = item.server_payload !== null || item.server_revision !== null
  await db.syncQueue.update(id, {
    ...(alreadyAnswered ? { client_operation_id: `${item.device_id}:${crypto.randomUUID()}` } : {}),
    status: 'pending', retry_count: 0, next_retry_at: null, error_code: null, error_message: null,
    // 旧 server_payload 属于上次冲突的服务端版本:残留会让"接受远端"按钮
    // 出现在普通失败态上,点击即应用过期版本。
    server_payload: null, server_revision: null, updated_at: ts,
  })
}

export async function forceLocalSyncQueueItem(id: string): Promise<void> {
  const ts = new Date().toISOString()
  const item = await db.syncQueue.get(id)
  if (!item) return
  await db.syncQueue.update(id, {
    client_operation_id: `${item.device_id}:${crypto.randomUUID()}`,
    status: 'pending',
    retry_count: 0,
    base_revision: null,
    next_retry_at: null,
    error_code: 'FORCE_LOCAL',
    error_message: 'Force local overwrite requested',
    server_payload: null,
    server_revision: null,
    updated_at: ts,
  })
  await logOperation({ entity_type: item.entity_type, entity_id: item.entity_id, operation: item.operation, status: 'ok', detail: 'force local' })
}

async function applyServerPayload(item: SyncQueueRecord): Promise<void> {
  const payload = item.server_payload
  // 无 server_payload 的 failed 项(网络错误等)没有"服务器版本"可接受:
  // 不删本地实体,避免点错按钮造成数据丢失。
  if (!payload || typeof payload !== 'object') return
  const row = payload as Record<string, unknown>
  const revision = item.server_revision ?? null
  if (row.deleted_at || row.is_deleted === 1) {
    await deleteLocalEntity(item.entity_type, item.entity_id)
    return
  }
  if (item.entity_type === 'bookmark') {
    const normalized = normalizeBookmarkRow({ ...row, id: item.entity_id, revision }).dto as LocalBookmark
    await db.bookmarks.put({ ...normalized, base_revision: revision, dirty_fields: [], pending_op: null })
  } else if (item.entity_type === 'bookmark_folder') {
    const normalized = normalizeFolderRow({ ...row, id: item.entity_id }).dto as LocalFolder
    await db.folders.put({ ...normalized, base_revision: revision, dirty_fields: [], pending_op: null })
  } else if (item.entity_type === 'tag') {
    const normalized = normalizeTagRow({ ...row, id: item.entity_id }).dto as LocalTag
    await db.tags.put({ ...normalized, base_revision: revision, dirty_fields: [], pending_op: null })
  } else if (item.entity_type === 'tab_group') {
    const normalized = normalizeTabGroupRow({ ...row, id: item.entity_id }).dto as LocalTabGroup
    const hasAuthoritativeTabs = Array.isArray((item.server_payload as { tabs?: unknown[] } | null)?.tabs)
    const serverTabs = hasAuthoritativeTabs ? ((item.server_payload as { tabs: unknown[] }).tabs) : []
    await db.tabGroups.put({ ...normalized, item_count: serverTabs.length, base_revision: revision, dirty_fields: [], pending_op: null })
    // 服务器组载荷内嵌全部条目,空数组同样是权威的"这个组现在没有条目"
    // (与 pull.ts 的 authoritativeTabs 同语义):按数组在场判定而非 length>0,
    // 否则接受远端的空组不清本地残留条目——幽灵条目留到下次 bootstrap。
    if (hasAuthoritativeTabs) {
      await db.tabGroupItems.where('group_id').equals(item.entity_id).delete()
      for (const tab of serverTabs) {
        const itemDto = normalizeTabGroupItemRow({ ...(tab as Record<string, unknown>), group_id: item.entity_id }).dto as LocalTabGroupItem
        await db.tabGroupItems.put({ ...itemDto, base_revision: revision, dirty_fields: [], pending_op: null })
      }
    }
  } else {
    const normalized = normalizeTabGroupItemRow({ ...row, id: item.entity_id }).dto as LocalTabGroupItem
    await db.tabGroupItems.put({ ...normalized, base_revision: revision, dirty_fields: [], pending_op: null })
  }
}

async function deleteLocalEntity(entityType: SyncQueueRecord['entity_type'], entityId: string): Promise<void> {
  if (entityType === 'bookmark') await db.bookmarks.delete(entityId)
  else if (entityType === 'bookmark_folder') await db.folders.delete(entityId)
  else if (entityType === 'tag') await db.tags.delete(entityId)
  else if (entityType === 'tab_group') {
    await db.tabGroups.delete(entityId)
    await db.tabGroupItems.where('group_id').equals(entityId).delete()
  } else await db.tabGroupItems.delete(entityId)
}

/** 接受服务器版本:applyServerPayload + 日志 + 队列删除 + cursor 重置,原子化避免中途崩溃导致半提交。 */
export async function acceptRemoteSyncQueueItem(id: string): Promise<void> {
  const item = await db.syncQueue.get(id)
  if (!item) return
  await db.transaction('rw', ACCEPT_REMOTE_TRANSACTION_TABLES, async () => {
    await applyServerPayload(item)
    await logOperation({ entity_type: item.entity_type, entity_id: item.entity_id, operation: item.operation, status: 'ok', detail: 'accept remote' })
    await db.syncQueue.delete(id)
    const rec = await db.syncState.get('singleton')
    if (rec) await db.syncState.put({ ...rec, cursor: null })
  })
}
