import { getCredentials, isAuthenticated } from '../api/auth'
import { type SyncStateRecord } from '../db'
import { getSyncState, saveSyncState } from '../db/sync-state'
import { repairPendingSyncQueue } from '../db/queue-repair'
import { bootstrapSync, pullChanges, type PullResult } from './pull'
import { pushDirty, type PushResult } from './push'

/** 全量 bootstrap 重触发阈值:距上次 bootstrap 超过此小时数则改用 bootstrap(捕获 web CRUD,因常规 CRUD 不写 sync_changes)。 */
const BOOTSTRAP_INTERVAL_HOURS = 24

export interface SyncResult {
  pushed: number
  pulled: number
  bootstrapped: boolean
  conflicts: number
  mode: SyncStateRecord['mode']
}

function hoursSince(iso: string | null): number {
  if (!iso) return Number.POSITIVE_INFINITY
  const ms = Date.now() - new Date(iso).getTime()
  return Number.isFinite(ms) ? ms / 3_600_000 : Number.POSITIVE_INFINITY
}

/** 判定本轮是否应做全量 bootstrap(首次 / 超过阈值未 bootstrap)。 */
function shouldBootstrap(state: SyncStateRecord): boolean {
  if (!state.cursor || !state.last_bootstrap_at) return true
  return hoursSince(state.last_bootstrap_at) >= BOOTSTRAP_INTERVAL_HOURS
}

/** 模块级 in-flight 同步互斥:popup/options/alarm 并发触发时共享同一 Promise。 */
let inFlight: Promise<SyncResult> | null = null

/** 主同步:push dirty → bootstrap 或 增量 pull;据鉴权/权益/暂停写回 syncState.mode。 */
export function runSync(): Promise<SyncResult> {
  if (inFlight) return inFlight
  inFlight = runSyncInner()
  return inFlight
}

async function runSyncInner(): Promise<SyncResult> {
  try {
    return await runSyncOnce()
  } finally {
    inFlight = null
  }
}
async function runSyncOnce(): Promise<SyncResult> {
  const cred = await getCredentials()
  if (!isAuthenticated(cred)) {
    await saveSyncState({ mode: 'local_only' })
    return { pushed: 0, pulled: 0, bootstrapped: false, conflicts: 0, mode: 'local_only' }
  }

  const state = await getSyncState()
  if (state.mode === 'paused') {
    return { pushed: 0, pulled: 0, bootstrapped: false, conflicts: 0, mode: 'paused' }
  }

  // 队列自修复:补建 dirty_fields 非空但无队列项的实体(崩溃/迁移残留)。
  try { await repairPendingSyncQueue() } catch (e) { console.warn('[TMark] sync queue repair failed:', e) }

  const push = await pushDirty()
  if (push.forbidden) {
    await saveSyncState({ mode: 'local_only' })
    return { pushed: push.accepted, pulled: 0, bootstrapped: false, conflicts: push.conflicts, mode: 'local_only' }
  }

  const pull: PullResult = shouldBootstrap(state) ? await bootstrapSync() : await pullChanges()
  if (pull.forbidden) {
    await saveSyncState({ mode: 'local_only' })
    return { pushed: push.accepted, pulled: pull.applied, bootstrapped: pull.bootstrapped, conflicts: push.conflicts, mode: 'local_only' }
  }

  await saveSyncState({ mode: 'cloud_sync' })
  return { pushed: push.accepted, pulled: pull.applied, bootstrapped: pull.bootstrapped, conflicts: push.conflicts, mode: 'cloud_sync' }
}

/** 强制全量 bootstrap(重同步,options 页"重新同步"按钮触发)。RC-E:复用 inFlight 互斥,
 * 避免 fullResync 与 runSync/runSyncOnce 并发竞态(此前 fullResync 不走 inFlight,可与常规同步重叠)。 */
export function fullResync(): Promise<SyncResult> {
  if (inFlight) return inFlight
  inFlight = fullResyncInner()
  return inFlight
}

async function fullResyncInner(): Promise<SyncResult> {
  try {
    const cred = await getCredentials()
    if (!isAuthenticated(cred)) {
      await saveSyncState({ mode: 'local_only' })
      return { pushed: 0, pulled: 0, bootstrapped: false, conflicts: 0, mode: 'local_only' }
    }
    try { await repairPendingSyncQueue() } catch (e) { console.warn('[TMark] sync queue repair failed:', e) }
    const push: PushResult = await pushDirty()
    if (push.forbidden) {
      await saveSyncState({ mode: 'local_only' })
      return { pushed: push.accepted, pulled: 0, bootstrapped: false, conflicts: push.conflicts, mode: 'local_only' }
    }
    const pull = await bootstrapSync()
    const mode = pull.forbidden ? 'local_only' : 'cloud_sync'
    await saveSyncState({ mode })
    return { pushed: push.accepted, pulled: pull.applied, bootstrapped: pull.bootstrapped, conflicts: push.conflicts, mode }
  } finally {
    inFlight = null
  }
}

export type { SyncStateRecord }
