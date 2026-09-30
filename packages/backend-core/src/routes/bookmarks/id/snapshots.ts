import { Hono } from 'hono'
import type { BookmarkSnapshotDTO, BookmarkSnapshotsResponse, CreateBookmarkSnapshotInput } from '@tmarks/contracts'
import type { Context } from 'hono'
import type { AppEnv } from '../../../lib/env'
import { requireDataAuth } from '../../../middleware/data-auth'
import { badRequest, created, internalError, notFound, success } from '../../../lib/response'
import { sanitizeString } from '../../../lib/validation'
import { deleteStorageCleanupJob, storageCleanupInsert } from '../../../lib/storage-cleanup'

const MAX_HTML_LENGTH = 6_000_000
const MAX_SNAPSHOT_VERSIONS = 20

interface BookmarkRow { id: string; title: string; url: string }
interface SnapshotRow {
  id: string
  bookmark_id: string
  user_id: string
  version: number
  storage_key: string
  snapshot_title: string
  source_url: string
  content_type: string
  content_size: number
  content_hash: string
  created_at: string
}

export const snapshotRoutes = new Hono<AppEnv>()
snapshotRoutes.get('/', requireDataAuth('bookmarks.read'), listSnapshotsHandler)
snapshotRoutes.post('/', requireDataAuth('bookmarks.update'), createSnapshotHandler)
snapshotRoutes.get('/:snapshotId', requireDataAuth('bookmarks.read'), getSnapshotHandler)
snapshotRoutes.delete('/:snapshotId', requireDataAuth('bookmarks.update'), deleteSnapshotHandler)

async function listSnapshotsHandler(c: Context<AppEnv>): Promise<Response> {
  const userId = c.get('auth')?.user_id
  const bookmarkId = c.req.param('id')
  if (!userId || !bookmarkId) return notFound('Bookmark not found')
  try {
    if (!(await findBookmark(c, userId, bookmarkId))) return notFound('Bookmark not found')
    const [rows, totalRow] = await Promise.all([
      c.env.DB.prepare(
        `SELECT id, bookmark_id, user_id, version, storage_key, snapshot_title, source_url,
         content_type, content_size, content_hash, created_at
         FROM bookmark_snapshots WHERE bookmark_id = ? AND user_id = ? ORDER BY version DESC`,
      ).bind(bookmarkId, userId).all<SnapshotRow>(),
      c.env.DB.prepare('SELECT COUNT(*) AS total FROM bookmark_snapshots WHERE bookmark_id = ? AND user_id = ?').bind(bookmarkId, userId).first<{ total: number }>(),
    ])
    const snapshots = rows.results ?? []
    const data: BookmarkSnapshotsResponse = { snapshots: snapshots.map((row, index) => mapSnapshot(row, index === 0)), total: Number(totalRow?.total ?? snapshots.length) }
    return success(data)
  } catch (error) {
    console.error('List bookmark snapshots error:', error)
    return internalError('Failed to list bookmark snapshots')
  }
}

async function createSnapshotHandler(c: Context<AppEnv>): Promise<Response> {
  const userId = c.get('auth')?.user_id
  const bookmarkId = c.req.param('id')
  if (!userId || !bookmarkId) return notFound('Bookmark not found')
  if (!c.env.SNAPSHOTS) return internalError('Snapshot storage is not configured', 'SNAPSHOT_STORAGE_UNAVAILABLE')

  try {
    const bookmark = await findBookmark(c, userId, bookmarkId)
    if (!bookmark) return notFound('Bookmark not found')
    const body = await c.req.json<CreateBookmarkSnapshotInput>().catch(() => null)
    if (!body || typeof body.html_content !== 'string' || body.html_content.trim().length === 0) return badRequest('html_content is required')
    if (body.html_content.length > MAX_HTML_LENGTH) return badRequest(`Snapshot HTML is limited to ${MAX_HTML_LENGTH} characters`)

    const html = body.html_content
    const bytes = new TextEncoder().encode(html)
    if (bytes.byteLength > MAX_HTML_LENGTH) return badRequest(`Snapshot HTML is limited to ${MAX_HTML_LENGTH} bytes`)
    const digest = await crypto.subtle.digest('SHA-256', bytes)
    const contentHash = [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('')

    // Content dedupe: re-saving an unchanged page must not burn a version
    // (and its R2 object). The extension captures a full snapshot on every
    // save, so without this the 20-version quota fills with identical copies.
    const latest = await c.env.DB.prepare(
      `SELECT id, bookmark_id, version, snapshot_title, source_url, content_type, content_size, content_hash, created_at
       FROM bookmark_snapshots WHERE bookmark_id = ? AND user_id = ? ORDER BY version DESC LIMIT 1`,
    ).bind(bookmarkId, userId).first<SnapshotRow>()
    if (latest && latest.content_hash === contentHash) {
      return success({ snapshot: mapSnapshot(latest, true) })
    }

    // Version quota: ROTATE, not reject — the previous behavior returned 400
    // SNAPSHOT_LIMIT_REACHED once 20 versions existed, so the 21st save of a
    // long-lived bookmark failed forever until the user manually deleted old
    // versions. Remember the oldest version now, but keep it intact until the
    // replacement object and row have both been created successfully.
    // (Concurrent uploads may transiently exceed the cap by one; the next
    // rotation self-corrects.)
    let oldestToRotate: { id: string; storageKey: string } | null = null
    const countRow = await c.env.DB.prepare('SELECT COUNT(*) AS total FROM bookmark_snapshots WHERE bookmark_id = ? AND user_id = ?').bind(bookmarkId, userId).first<{ total: number }>()
    if (Number(countRow?.total ?? 0) >= MAX_SNAPSHOT_VERSIONS) {
      const oldest = await c.env.DB.prepare(
        `SELECT id, storage_key FROM bookmark_snapshots WHERE bookmark_id = ? AND user_id = ? ORDER BY version ASC LIMIT 1`,
      ).bind(bookmarkId, userId).first<{ id: string; storage_key: string }>()
      if (oldest) oldestToRotate = { id: oldest.id, storageKey: oldest.storage_key }
    }

    const id = crypto.randomUUID()
    const storageKey = `snapshots/${userId}/${bookmarkId}/${id}.html`
    const title = sanitizeString(body.title?.trim() || bookmark.title, 200)
    const sourceUrl = sanitizeString(body.url?.trim() || bookmark.url, 2000)
    const createdAt = new Date().toISOString()
    await c.env.SNAPSHOTS.put(storageKey, html, {
      httpMetadata: { contentType: 'text/html; charset=utf-8', cacheControl: 'private, no-store' },
      customMetadata: { bookmarkId, userId },
    })

    let version: number
    try {
      // The version is assigned atomically inside the INSERT (COALESCE(MAX)+1)
      // so concurrent uploads cannot collide on the UNIQUE(bookmark_id,
      // version) constraint.
      const inserted = await c.env.DB.prepare(
        `INSERT INTO bookmark_snapshots
         (id, bookmark_id, user_id, version, storage_key, snapshot_title, source_url, content_type, content_size, content_hash, created_at)
         SELECT ?, ?, ?, COALESCE(MAX(version), 0) + 1, ?, ?, ?, ?, ?, ?, ?
         FROM bookmark_snapshots
         WHERE bookmark_id = ? AND user_id = ?
         RETURNING version`,
      ).bind(id, bookmarkId, userId, storageKey, title, sourceUrl, 'text/html; charset=utf-8', bytes.byteLength, contentHash, createdAt, bookmarkId, userId).first<{ version: number }>()
      version = Number(inserted?.version ?? 0)
      if (!version) throw new Error('Failed to assign snapshot version')
    } catch (error) {
      await c.env.SNAPSHOTS.delete(storageKey)
      throw error
    }

    if (oldestToRotate) {
      // Delete the old row and enqueue its key atomically. A failed R2 delete
      // can then be retried by scheduled maintenance without losing the key.
      await c.env.DB.batch([
        c.env.DB
          .prepare('DELETE FROM bookmark_snapshots WHERE id = ? AND user_id = ?')
          .bind(oldestToRotate.id, userId),
        ...storageCleanupInsert(c.env.DB, [{ storageKey: oldestToRotate.storageKey, kind: 'snapshot', userId }]),
      ])
      // The replacement is already durable in both stores. A failed cleanup of
      // the now-unreachable old object must not turn that success into a 500.
      await c.env.SNAPSHOTS.delete(oldestToRotate.storageKey)
        .then(() => deleteStorageCleanupJob(c.env.DB, oldestToRotate.storageKey))
        .catch(() => undefined)
    }

    const snapshot: BookmarkSnapshotDTO = { id, bookmark_id: bookmarkId, version, snapshot_title: title, source_url: sourceUrl, content_type: 'text/html; charset=utf-8', content_size: bytes.byteLength, content_hash: contentHash, is_latest: true, created_at: createdAt }
    return created({ snapshot })
  } catch (error) {
    console.error('Create bookmark snapshot error:', error)
    return internalError('Failed to create bookmark snapshot')
  }
}

async function getSnapshotHandler(c: Context<AppEnv>): Promise<Response> {
  const userId = c.get('auth')?.user_id
  const bookmarkId = c.req.param('id')
  const snapshotId = c.req.param('snapshotId')
  if (!userId || !bookmarkId || !snapshotId) return notFound('Snapshot not found')
  if (!c.env.SNAPSHOTS) return internalError('Snapshot storage is not configured', 'SNAPSHOT_STORAGE_UNAVAILABLE')
  try {
    const row = await findSnapshot(c, userId, bookmarkId, snapshotId)
    if (!row) return notFound('Snapshot not found')
    const object = await c.env.SNAPSHOTS.get(row.storage_key)
    if (!object?.body) return notFound('Snapshot content not found')
    const headers = new Headers({ 'Content-Type': row.content_type, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; img-src https: data:; style-src 'unsafe-inline' https:; font-src https: data:; base-uri 'none'" })
    // Snapshots are immutable — an ETag turns repeat views into empty 304s
    // instead of re-transferring a multi-megabyte body each time.
    const etag = `"${row.content_hash}"`
    headers.set('ETag', etag)
    if (c.req.header('If-None-Match') === etag) {
      return new Response(null, { status: 304, headers })
    }
    return new Response(object.body, { headers })
  } catch (error) {
    console.error('Get bookmark snapshot error:', error)
    return internalError('Failed to load bookmark snapshot')
  }
}

async function deleteSnapshotHandler(c: Context<AppEnv>): Promise<Response> {
  const userId = c.get('auth')?.user_id
  const bookmarkId = c.req.param('id')
  const snapshotId = c.req.param('snapshotId')
  if (!userId || !bookmarkId || !snapshotId) return notFound('Snapshot not found')
  if (!c.env.SNAPSHOTS) return internalError('Snapshot storage is not configured', 'SNAPSHOT_STORAGE_UNAVAILABLE')
  try {
    const row = await findSnapshot(c, userId, bookmarkId, snapshotId)
    if (!row) return notFound('Snapshot not found')

    // R5-8: the row delete + outbox insert commit FIRST (one atomic batch).
    // The old order (R2 object delete before the row delete) left a row
    // pointing at a deleted object whenever the D1 delete failed — every
    // fetch of that version then 404'd with "content not found". A failed R2
    // cleanup after the commit is retried by the scheduled drain instead of
    // corrupting the row (same pattern as the rotation path).
    await c.env.DB.batch([
      c.env.DB
        .prepare('DELETE FROM bookmark_snapshots WHERE id = ? AND bookmark_id = ? AND user_id = ?')
        .bind(snapshotId, bookmarkId, userId),
      ...storageCleanupInsert(c.env.DB, [{ storageKey: row.storage_key, kind: 'snapshot', userId }]),
    ])

    await c.env.SNAPSHOTS.delete(row.storage_key)
      .then(() => deleteStorageCleanupJob(c.env.DB, row.storage_key))
      .catch(() => undefined)
    return success({ deleted: true })
  } catch (error) {
    console.error('Delete bookmark snapshot error:', error)
    return internalError('Failed to delete bookmark snapshot')
  }
}

async function findBookmark(c: Context<AppEnv>, userId: string, bookmarkId: string): Promise<BookmarkRow | null> {
  return c.env.DB.prepare('SELECT id, title, url FROM bookmarks WHERE id = ? AND user_id = ? AND deleted_at IS NULL').bind(bookmarkId, userId).first<BookmarkRow>()
}

async function findSnapshot(c: Context<AppEnv>, userId: string, bookmarkId: string, snapshotId: string): Promise<SnapshotRow | null> {
  return c.env.DB.prepare(
    `SELECT id, bookmark_id, user_id, version, storage_key, snapshot_title, source_url,
     content_type, content_size, content_hash, created_at
     FROM bookmark_snapshots WHERE id = ? AND bookmark_id = ? AND user_id = ?`,
  ).bind(snapshotId, bookmarkId, userId).first<SnapshotRow>()
}

function mapSnapshot(row: SnapshotRow, latest: boolean): BookmarkSnapshotDTO {
  return { id: row.id, bookmark_id: row.bookmark_id, version: row.version, snapshot_title: row.snapshot_title, source_url: row.source_url, content_type: row.content_type, content_size: row.content_size, content_hash: row.content_hash, is_latest: latest, created_at: row.created_at }
}
