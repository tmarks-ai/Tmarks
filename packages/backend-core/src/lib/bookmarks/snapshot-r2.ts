import type { AppEnv } from '../env'
import { deleteStorageCleanupJob, storageKeyIsAssetReferenced } from '../storage-cleanup'

/**
 * Drop snapshot R2 objects whose table rows were just deleted. Best-effort:
 * the row deletion already committed, so an R2 failure logs and leaves the
 * durable outbox job for the scheduled drain to retry. A successful immediate
 * delete removes that job; a D1 cleanup failure leaves it harmlessly queued.
 */
export function purgeSnapshotObjects(
  env: AppEnv['Bindings'],
  keys: string[] | undefined,
  waitUntil: (promise: Promise<unknown>) => void,
  requestUrl?: string,
): void {
  if (!keys || keys.length === 0 || !env.SNAPSHOTS) return

  let origin: string | null = null
  if (requestUrl) {
    try {
      origin = new URL(requestUrl).origin
    } catch {
      origin = null
    }
  }
  waitUntil(Promise.all(keys.map(async (key) => {
    try {
      // An asset can be referenced again between orphan discovery and this
      // immediate cleanup. Recheck before deleting it, just like the drain.
      if (await storageKeyIsAssetReferenced(env.DB, key)) {
        await deleteStorageCleanupJob(env.DB, key)
        return
      }
      const asset = key.match(/^assets\/(favicon|cover)\/([0-9a-f]{64})$/)
      if (origin && asset) {
        // Awaited inside the waitUntil'd promise (R5-P3): a floating catch can
        // be dropped when the isolate settles. The delete is idempotent — a
        // failure only leaves the immutable asset cached per its existing
        // max-age headers, which the next cache miss will revalidate.
        await caches.default.delete(new Request(`${origin}/api/public/assets/${asset[1]}/${asset[2]}`)).catch((error) => {
          console.error('Asset cache purge failed:', error)
        })
      }
      await env.SNAPSHOTS!.delete(key)
      await deleteStorageCleanupJob(env.DB, key)
    } catch (error) {
      // The outbox row was committed with the D1 deletion. Leave it for the
      // scheduled drain and keep the request successful.
      console.error('Immediate storage purge failed:', error)
    }
  })))
}
