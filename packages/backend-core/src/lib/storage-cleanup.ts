import type { Env } from './env'
import { isAssetPath } from './bookmarks/asset-persist'

export type StorageCleanupKind = 'snapshot' | 'asset'

export interface StorageCleanupJob {
  storage_key: string
  kind: StorageCleanupKind
  user_id: string | null
  attempts: number
  next_retry_at: string
  last_error: string | null
}

export interface StorageCleanupDrainResult {
  processed: number
  deleted: number
  skippedReferenced: number
  failed: number
}

const DEFAULT_DRAIN_LIMIT = 100
const RETRY_BASE_MS = 1_000
const RETRY_MAX_MS = 60 * 60 * 1_000
// R5-P3 (dead-letter): a permanently failing key (e.g. the R2 binding revoked
// for that prefix) retried hourly forever = ~24 wasted D1 writes/day per key.
// After this many attempts the drain stops rescheduling the job; the row stays
// for inspection/requeue instead of burning writes.
const MAX_DRAIN_ATTEMPTS = 24
const MAX_ERROR_LENGTH = 1_000
const ASSET_KEY_RE = /^assets\/(favicon|cover)\/([0-9a-f]{64})$/

/**
 * Build the INSERT statements used in the same D1 batch as a storage-key
 * deletion. INSERT OR IGNORE deliberately preserves an existing retry count
 * when the same immutable asset is discovered again.
 */
export function storageCleanupInsert(
  db: D1Database,
  jobs: Array<{ storageKey: string; kind: StorageCleanupKind; userId?: string | null }>,
  now = new Date().toISOString(),
): D1PreparedStatement[] {
  return jobs.map((job) =>
    db
      .prepare(
        `INSERT OR IGNORE INTO storage_cleanup_jobs
         (storage_key, kind, user_id, attempts, next_retry_at, last_error, created_at, updated_at)
         VALUES (?, ?, ?, 0, ?, NULL, ?, ?)`,
      )
      .bind(job.storageKey, job.kind, job.userId ?? null, now, now, now),
  )
}

/**
 * Find asset paths that are not referenced by any bookmark that will survive
 * the current deletion. This must run before the delete batch: doing it after
 * the commit cannot make the orphan discovery and the delete atomic.
 */
export async function collectOrphanedAssetKeysBeforeDelete(
  db: D1Database,
  assetPaths: Array<string | null | undefined>,
  options: { excludeBookmarkIds?: string[]; excludeTrashedForUserId?: string } = {},
): Promise<string[]> {
  const unique = [...new Set(assetPaths.filter((path): path is string => isAssetPath(path)))]
  if (unique.length === 0) return []

  const excludedIds = options.excludeBookmarkIds ?? []
  let excludedClause = ''
  let excludedParams: string[] = []
  if (options.excludeTrashedForUserId) {
    excludedClause = 'AND NOT (user_id = ? AND deleted_at IS NOT NULL)'
    excludedParams = [options.excludeTrashedForUserId]
  } else if (excludedIds.length > 0) {
    excludedClause = `AND id NOT IN (${excludedIds.map(() => '?').join(',')})`
    excludedParams = excludedIds
  }

  const { results } = await db
    .prepare(
      `SELECT DISTINCT favicon AS p FROM bookmarks
       WHERE favicon IS NOT NULL ${excludedClause}
       UNION
       SELECT DISTINCT cover_image AS p FROM bookmarks
       WHERE cover_image IS NOT NULL ${excludedClause}`,
    )
    .bind(...excludedParams, ...excludedParams)
    .all<{ p: string }>()
  const referenced = new Set((results ?? []).map((row) => row.p))
  return unique
    .filter((path) => !referenced.has(path))
    .map((path) => `assets/${path.slice('/api/public/assets/'.length)}`)
}

export async function deleteStorageCleanupJob(db: D1Database, storageKey: string): Promise<void> {
  await db.prepare('DELETE FROM storage_cleanup_jobs WHERE storage_key = ?').bind(storageKey).run()
}

function assetPathFromStorageKey(storageKey: string): string | null {
  const match = storageKey.match(ASSET_KEY_RE)
  return match ? `/api/public/assets/${match[1]}/${match[2]}` : null
}

export async function storageKeyIsAssetReferenced(db: D1Database, storageKey: string): Promise<boolean> {
  const path = assetPathFromStorageKey(storageKey)
  if (!path) return false
  const row = await db
    .prepare('SELECT 1 AS referenced FROM bookmarks WHERE favicon = ? OR cover_image = ? LIMIT 1')
    .bind(path, path)
    .first<{ referenced: number }>()
  return row !== null
}

function errorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return message.slice(0, MAX_ERROR_LENGTH)
}

function nextRetryAt(now: Date, attemptsBeforeFailure: number): string {
  const delay = Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** Math.min(attemptsBeforeFailure, 10))
  return new Date(now.getTime() + delay).toISOString()
}

/**
 * Drain due R2 cleanup jobs. A successful R2 delete removes the job; a failure
 * records the error and schedules exponential retry. Assets are rechecked
 * against every bookmark immediately before deletion because content-addressed
 * objects can become referenced again after the original orphan discovery.
 */
export async function drainStorageCleanupJobs(
  env: Pick<Env, 'DB' | 'SNAPSHOTS'>,
  options: { limit?: number; now?: Date } = {},
): Promise<StorageCleanupDrainResult> {
  const result: StorageCleanupDrainResult = { processed: 0, deleted: 0, skippedReferenced: 0, failed: 0 }
  if (!env.SNAPSHOTS) return result

  const limit = Math.max(0, Math.min(options.limit ?? DEFAULT_DRAIN_LIMIT, 1000))
  if (limit === 0) return result
  const now = options.now ?? new Date()
  const nowIso = now.toISOString()
  const { results: jobs } = await env.DB
    .prepare(
      `SELECT storage_key, kind, user_id, attempts, next_retry_at, last_error
       FROM storage_cleanup_jobs
       WHERE next_retry_at <= ? AND attempts < ?
       ORDER BY next_retry_at ASC, created_at ASC
       LIMIT ?`,
    )
    .bind(nowIso, MAX_DRAIN_ATTEMPTS, limit)
    .all<StorageCleanupJob>()

  for (const job of jobs ?? []) {
    result.processed += 1
    try {
      if (job.kind === 'asset' && (await storageKeyIsAssetReferenced(env.DB, job.storage_key))) {
        await deleteStorageCleanupJob(env.DB, job.storage_key)
        result.skippedReferenced += 1
        continue
      }
      await env.SNAPSHOTS.delete(job.storage_key)
      await deleteStorageCleanupJob(env.DB, job.storage_key)
      result.deleted += 1
    } catch (error) {
      const attempts = Number(job.attempts ?? 0) + 1
      if (attempts >= MAX_DRAIN_ATTEMPTS) {
        // Dead-letter: record the terminal failure and stop rescheduling — the
        // attempts < MAX filter above keeps the row out of every later drain
        // (zero further reads/writes). The row stays for inspection/requeue.
        await env.DB
          .prepare(
            `UPDATE storage_cleanup_jobs
             SET attempts = ?, last_error = ?, updated_at = ?
             WHERE storage_key = ?`,
          )
          .bind(attempts, errorMessage(error), nowIso, job.storage_key)
          .run()
      } else {
        await env.DB
          .prepare(
            `UPDATE storage_cleanup_jobs
             SET attempts = ?, next_retry_at = ?, last_error = ?, updated_at = ?
             WHERE storage_key = ?`,
          )
          .bind(attempts, nextRetryAt(now, Number(job.attempts ?? 0)), errorMessage(error), nowIso, job.storage_key)
          .run()
      }
      result.failed += 1
    }
  }

  return result
}

export const storageCleanupDefaults = {
  drainLimit: DEFAULT_DRAIN_LIMIT,
  retryBaseMs: RETRY_BASE_MS,
  retryMaxMs: RETRY_MAX_MS,
}
