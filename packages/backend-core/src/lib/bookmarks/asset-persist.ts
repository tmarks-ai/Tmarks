import { emitSyncChange } from '../sync/sync-emit'
import { fetchExternalResource } from '../net/external-fetch'
import type { Context } from 'hono'
import type { AppEnv, Env } from '../env'

/**
 * Persist bookmark favicon/cover images into R2 so they survive the original
 * site changing or removing them (the bookmark row is rewritten to a
 * content-addressed asset URL served by this Worker).
 *
 * Design points:
 * - Runs in the background (executionCtx.waitUntil) AFTER the save response —
 *   a slow or dead origin never blocks the bookmark write.
 * - Content-addressed keys (`assets/<kind>/<sha256>`) dedupe across bookmarks
 *   and users; objects are immutable per hash and therefore never rewritten.
 * - Served from the unauthenticated route (an <img> tag cannot carry a Bearer
 *   header): the 64-hex sha256 path is unguessable — the same posture as the
 *   public share slug — and the content is a public website image anyway.
 * - SSRF: the URL and every redirect hop pass the shared public-host guard
 *   (lib/net/public-url.ts) — an og:image pointed at an internal service is
 *   never fetched, let alone copied into public R2 storage.
 * - SVG is excluded on write: image/svg+xml is a script execution surface and
 *   today's <img> consumers must not become tomorrow's inline embeds.
 * - Failure keeps the original remote URL (degrade to today's behaviour);
 *   no error is surfaced to the caller.
 * - Fields already pointing at asset URLs are skipped (idempotent re-save).
 * - Skipped entirely when SNAPSHOTS is not bound (self-host without R2).
 */

const MAX_IMAGE_BYTES = 5 * 1024 * 1024
const FETCH_TIMEOUT_MS = 8000

export type AssetKind = 'favicon' | 'cover'

const ASSET_URL_PREFIX = '/api/public/assets/'

export function assetPath(kind: AssetKind, hash: string): string {
  return `${ASSET_URL_PREFIX}${kind}/${hash}`
}

// R5-P3: strict-shape check aligned with the drain's ASSET_KEY_RE — the old
// prefix-only match let non-conforming user-set strings (sanitizeString allows
// arbitrary /api/public/assets/... text) become outbox rows whose key never
// matches the drain's regex. Impact was nil (R2 deletes of such keys are
// no-ops), but the asymmetry invited confusion.
const ASSET_URL_RE = /^\/api\/public\/assets\/(favicon|cover)\/([0-9a-f]{64})$/

/** True when the stored field already points at our own asset route (strict shape). */
export function isAssetPath(value: string | null | undefined): value is string {
  return typeof value === 'string' && ASSET_URL_RE.test(value)
}

/**
 * After rows are deleted, find asset paths nobody references anymore and
 * return their R2 keys for best-effort deletion. Objects are shared across
 * bookmarks/users by content hash, so a reference count — not ownership —
 * decides whether the object is garbage.
 *
 * Single grouped query (NOT one COUNT(*) per path): favicon/cover_image carry
 * no index, so per-path counts were per-path FULL table scans — emptying a
 * few hundred trashed bookmarks issued hundreds of D1 subrequests (free tier
 * caps at 50) and could blow the wall-time budget. One DISTINCT scan of
 * surviving rows + an in-memory diff is bounded by unique URLs instead.
 */
export async function collectOrphanedAssetKeys(
  db: D1Database,
  assetPaths: Array<string | null | undefined>
): Promise<string[]> {
  const unique = [...new Set(assetPaths.filter((p): p is string => isAssetPath(p)))]
  if (unique.length === 0) return []
  const { results } = await db
    .prepare(
      `SELECT DISTINCT favicon AS p FROM bookmarks WHERE favicon IS NOT NULL
       UNION
       SELECT DISTINCT cover_image AS p FROM bookmarks WHERE cover_image IS NOT NULL`,
    )
    .all<{ p: string }>()
  const referenced = new Set((results || []).map((row) => row.p))
  return unique
    .filter((path) => !referenced.has(path))
    .map((path) => `assets/${path.slice(ASSET_URL_PREFIX.length)}`)
}

/** Fire-and-forget wrapper for route handlers (needs c.executionCtx). */
export function schedulePersistBookmarkImages(
  env: Pick<Env, 'DB' | 'SNAPSHOTS'>,
  ctx: Pick<ExecutionContext, 'waitUntil'>,
  userId: string,
  bookmarkId: string,
  favicon: string | null | undefined,
  coverImage: string | null | undefined,
): void {
  if (!env.SNAPSHOTS) return
  ctx.waitUntil(persistBookmarkImages(env, userId, bookmarkId, favicon, coverImage).catch(() => undefined))
}

/**
 * Route-handler entry point. Tolerates a missing ExecutionContext (the
 * unit-test harness): persistence is skipped and the bookmark simply keeps
 * its remote URLs — identical to the pre-persistence behaviour.
 */
export function schedulePersistFromContext(
  c: Context<AppEnv>,
  userId: string,
  bookmarkId: string,
  favicon: string | null | undefined,
  coverImage: string | null | undefined,
): void {
  if (!c.env.SNAPSHOTS) return
  try {
    schedulePersistBookmarkImages(c.env, c.executionCtx, userId, bookmarkId, favicon, coverImage)
  } catch {
    /* no execution context available — skip */
  }
}

export async function persistBookmarkImages(
  env: Pick<Env, 'DB' | 'SNAPSHOTS'>,
  userId: string,
  bookmarkId: string,
  favicon: string | null | undefined,
  coverImage: string | null | undefined,
): Promise<void> {
  if (!env.SNAPSHOTS) return
  const [faviconAsset, coverAsset] = await Promise.all([
    persistField(env.SNAPSHOTS, 'favicon', favicon),
    persistField(env.SNAPSHOTS, 'cover', coverImage),
  ])
  if (!faviconAsset && !coverAsset) return

  // Each field is a compare-and-swap: a user may update or clear it while the
  // origin download is in flight. Keep the current value unless it still
  // equals the URL captured at scheduling time, and require at least one field
  // to still match so an all-stale task performs no write at all.
  const updates: string[] = []
  const values: Array<string | null> = []
  const conditions: string[] = []
  if (faviconAsset) {
    updates.push('favicon = CASE WHEN favicon = ? THEN ? ELSE favicon END')
    values.push(favicon!, faviconAsset)
    conditions.push('favicon = ?')
  }
  if (coverAsset) {
    updates.push('cover_image = CASE WHEN cover_image = ? THEN ? ELSE cover_image END')
    values.push(coverImage!, coverAsset)
    conditions.push('cover_image = ?')
  }
  updates.push('updated_at = ?')
  values.push(new Date().toISOString(), bookmarkId, userId)
  for (const condition of conditions) values.push(condition === 'favicon = ?' ? favicon! : coverImage!)

  const result = await env.DB.prepare(
    `UPDATE bookmarks SET ${updates.join(', ')}
     WHERE id = ? AND user_id = ? AND deleted_at IS NULL
       AND (${conditions.join(' OR ')})`
  )
    .bind(...values)
    .run()

  // A stale task must not emit a misleading upsert. D1 reports the number of
  // rows matched/changed here; zero means another write won the race or the row
  // was deleted, so there is nothing for the extension to pull.
  if (result.meta.changes === 0) return

  // The extension's incremental pull needs this to swap its local row to the
  // asset URL; a second change record right after the save's own one is fine.
  await emitSyncChange(env.DB, userId, 'bookmark', bookmarkId, 'upsert')
}

/** Download one image and store it under its content hash. Returns the asset URL, or null when unusable. */
async function persistField(
  bucket: R2Bucket,
  kind: AssetKind,
  url: string | null | undefined
): Promise<string | null> {
  if (!url || isAssetPath(url)) return null

  const fetched = await fetchExternalResource(url, { timeoutMs: FETCH_TIMEOUT_MS })
  if (!fetched) return null
  const { response } = fetched
  if (!response.ok) return null

  const contentType = (response.headers.get('content-type') || '').split(';')[0]!.trim()
  if (!contentType.startsWith('image/') || contentType === 'image/svg+xml') return null

  const bytes = await readCapped(response)
  if (!bytes || bytes.byteLength === 0) return null

  const hash = await sha256Hex(bytes)
  await bucket.put(`assets/${kind}/${hash}`, bytes, {
    httpMetadata: { contentType, cacheControl: 'public, max-age=31536000, immutable' },
  })
  return assetPath(kind, hash)
}

/** Stream-read up to the cap, then cancel — never buffer an unbounded body. */
async function readCapped(response: Response): Promise<Uint8Array | null> {
  const reader = response.body?.getReader()
  if (!reader) return null

  const declaredLength = Number(response.headers.get('content-length') || '0')
  if (declaredLength > MAX_IMAGE_BYTES) {
    await reader.cancel().catch(() => undefined)
    return null
  }

  const chunks: Uint8Array[] = []
  let received = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    received += value.byteLength
    if (received > MAX_IMAGE_BYTES) {
      await reader.cancel().catch(() => undefined)
      return null
    }
    chunks.push(value)
  }

  const out = new Uint8Array(received)
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.byteLength
  }
  return out
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes as unknown as ArrayBuffer)
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}
