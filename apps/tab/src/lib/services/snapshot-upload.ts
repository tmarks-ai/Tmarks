import type { BookmarkSnapshotDTO, EntityId } from '@tmarks/contracts'
import { db, type SnapshotUploadRecord } from '../db'
import { snapshotsApi } from '../api/snapshots'
import type { CapturedSnapshot } from './snapshot-capture'

/** 指数退避:2^n * 1s,上限 1h(镜像 sync queue 退避策略)。 */
function nextRetryAt(retryCount: number): string {
  const delayMs = Math.min(60 * 60 * 1000, 2 ** retryCount * 1000)
  return new Date(Date.now() + delayMs).toISOString()
}

/** 取到期上传项(pending 立即;failed 须过 next_retry_at)。 */
async function takeDueUploads(): Promise<SnapshotUploadRecord[]> {
  const nowIso = new Date().toISOString()
  const all = await db.snapshotUploads.where('status').anyOf(['pending', 'failed']).toArray()
  return all
    .filter((r) => r.status === 'pending' || !r.next_retry_at || r.next_retry_at <= nowIso)
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
}

const MAX_RETRY = 8

// R5-P3: exhausted rows (terminal rejections or the 8-retry budget spent) are
// retained deliberately so the snapshot is never lost — but nothing ever
// cleaned them up, and each carries up to 6MB of HTML. Age out rows older
// than 30 days: past that point the bookmark has usually been deleted (the
// upload would 404 anyway) and the storage cost outweighs recovery value.
// Unbounded disk growth on unlimitedStorage is the alternative.
const EXHAUSTED_RETENTION_MS = 30 * 24 * 60 * 60 * 1000

/** Age out exhausted upload rows past the retention window (called from the drain). */
async function purgeExpiredExhausted(): Promise<number> {
  const cutoff = new Date(Date.now() - EXHAUSTED_RETENTION_MS).toISOString()
  return db.snapshotUploads
    .where('status')
    .equals('exhausted')
    .filter((r) => r.updated_at <= cutoff)
    .delete()
}

/**
 * 快照本地优先保存:create 即写本地(永不丢),返回 record id。上传由 pushSnapshots
 * 异步进行(enqueue 即触发一次 + 5min alarm 兜底重试)。调用方应立即向用户反馈"已保存"。
 */
export async function enqueueSnapshotUpload(bookmarkId: EntityId, capture: CapturedSnapshot): Promise<string> {
  const now = new Date().toISOString()
  const record: SnapshotUploadRecord = {
    id: crypto.randomUUID(),
    bookmark_id: bookmarkId,
    title: capture.title,
    url: capture.url,
    html_content: capture.html_content,
    status: 'pending',
    retry_count: 0,
    next_retry_at: null,
    error_code: null,
    error_message: null,
    created_at: now,
    updated_at: now,
  }
  await db.snapshotUploads.put(record)
  void pushSnapshots().catch((e) => console.warn('[TMark] snapshot upload trigger failed:', e))
  return record.id
}

let inFlight: Promise<{ uploaded: BookmarkSnapshotDTO[]; failed: number }> | null = null

/** 排空到期快照:逐条上传 R2,成功删本地行(缓冲释放),失败退避重试。模块级互斥防并发。 */
export function pushSnapshots(): Promise<{ uploaded: BookmarkSnapshotDTO[]; failed: number }> {
  if (inFlight) return inFlight
  inFlight = drainSnapshots().finally(() => { inFlight = null })
  return inFlight
}

async function drainSnapshots(): Promise<{ uploaded: BookmarkSnapshotDTO[]; failed: number }> {
  // R5-P3: expired exhausted rows go first — they never re-enter the loop and
  // would otherwise accumulate on disk forever.
  const purged = await purgeExpiredExhausted().catch(() => 0)
  if (purged > 0) console.log('[TMark] aged out', purged, 'exhausted snapshot upload rows')

  const due = await takeDueUploads()
  if (due.length === 0) return { uploaded: [], failed: 0 }

  const uploaded: BookmarkSnapshotDTO[] = []
  let failed = 0
  for (const item of due) {
    const ts = new Date().toISOString()
    // 原子认领:popup 与 background 都会排水,模块级互斥只护单上下文。
    // 条件 modify 在同一个写事务内完成读-改-写,输了竞态(0 行被改)说明
    // 另一上下文已认领本条,跳过即可,否则同一快照会被 POST 两次。
    const claimed = await db.snapshotUploads
      .where('id')
      .equals(item.id)
      .filter((r) => r.status === 'pending' || r.status === 'failed')
      .modify({ status: 'uploading', updated_at: ts })
    if (claimed === 0) continue
    try {
      const created = await snapshotsApi.create(item.bookmark_id, {
        html_content: item.html_content,
        title: item.title,
        url: item.url,
      })
      // 上传成功:本地缓冲释放(R2 为权威副本)。
      await db.snapshotUploads.delete(item.id)
      uploaded.push(created)
    } catch (e) {
      failed++
      const retryCount = item.retry_count + 1
      const err = e as { code?: string; message?: string }
      // 服务端语义性拒绝立即死信,不退避重试(重试同样的 6MB 载荷毫无意义)。
      // SNAPSHOT_LIMIT_REACHED 仅在未升级的旧服务端出现——新版已改为轮换。
      const terminal = err.code === 'SNAPSHOT_LIMIT_REACHED' || err.code === 'SNAPSHOT_STORAGE_UNAVAILABLE'
      const exhausted = terminal || retryCount >= MAX_RETRY
      // exhausted 是终态:takeDueUploads 只取 pending/failed,停止无限重试;
      // 行保留在本地缓冲(不删),数据不丢。
      await db.snapshotUploads.update(item.id, {
        status: exhausted ? 'exhausted' : 'failed',
        retry_count: retryCount,
        next_retry_at: exhausted ? null : nextRetryAt(retryCount),
        error_code: err.code ?? 'UPLOAD_ERROR',
        error_message: err.message ?? 'Snapshot upload failed',
        updated_at: new Date().toISOString(),
      })
      console.warn('[TMark] snapshot upload failed:', item.id, e)
    }
  }
  return { uploaded, failed }
}
