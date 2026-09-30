import { afterEach, describe, expect, it } from 'vitest'
import { checkMigrationsApplied } from '../src/lib/migration-gate'
import { permanentDeleteBookmark } from '../src/lib/bookmarks/bookmark-trash'
import { drainStorageCleanupJobs, storageCleanupInsert } from '../src/lib/storage-cleanup'
import { createSqliteD1, type SqliteD1Harness } from './helpers/sqlite-d1'

const USER = 'user-1'
const NOW = '2026-01-01T00:00:00.000Z'
const ASSET_HASH = 'a'.repeat(64)
const ASSET_PATH = `/api/public/assets/favicon/${ASSET_HASH}`

let harness: SqliteD1Harness | null = null

function db(): SqliteD1Harness {
  harness = createSqliteD1(USER)
  return harness
}

afterEach(() => {
  harness?.close()
  harness = null
})

function r2(options: { failDelete?: boolean } = {}) {
  const store = new Map<string, string>()
  return {
    store,
    binding: {
      async delete(key: string) {
        if (options.failDelete) throw new Error('R2 unavailable')
        store.delete(key)
      },
    } as unknown as R2Bucket,
  }
}

function enqueue(h: SqliteD1Harness, key: string, kind: 'snapshot' | 'asset'): void {
  h.db.batch(storageCleanupInsert(h.db, [{ storageKey: key, kind, userId: USER }], NOW))
}

function job(h: SqliteD1Harness, key: string): { attempts: number; next_retry_at: string; last_error: string | null } {
  return h.sqlite
    .prepare('SELECT attempts, next_retry_at, last_error FROM storage_cleanup_jobs WHERE storage_key = ?')
    .get(key) as { attempts: number; next_retry_at: string; last_error: string | null }
}

describe('storage cleanup outbox', () => {
  it('keeps snapshot and confirmed orphan asset keys in the same permanent-delete batch', async () => {
    const h = db()
    const now = new Date().toISOString()
    h.sqlite
      .prepare(
        `INSERT INTO bookmarks (id, user_id, title, url, favicon, deleted_at, created_at, updated_at)
         VALUES ('bm-1', ?, 't', 'https://example.com/a', ?, ?, ?, ?)`,
      )
      .run(USER, ASSET_PATH, now, now, now)
    h.sqlite
      .prepare(
        `INSERT INTO bookmark_snapshots
         (id, bookmark_id, user_id, version, storage_key, snapshot_title, source_url, content_size, content_hash, created_at)
         VALUES ('snap-1', 'bm-1', ?, 1, 'snapshots/u/bm-1/one.html', 't', 'https://example.com/a', 1, 'hash', ?)`,
      )
      .run(USER, now)

    const result = await permanentDeleteBookmark(h.db, 'bm-1', USER)

    expect(result.success).toBe(true)
    expect(result.orphanedStorageKeys).toEqual([`snapshots/u/bm-1/one.html`, `assets/favicon/${ASSET_HASH}`])
    expect(
      h.sqlite.prepare('SELECT kind FROM storage_cleanup_jobs ORDER BY kind').all()
    ).toEqual([{ kind: 'asset' }, { kind: 'snapshot' }])
  })

  it('does not enqueue an asset hash still referenced by another bookmark', async () => {
    const h = db()
    const now = new Date().toISOString()
    h.sqlite
      .prepare(
        `INSERT INTO bookmarks (id, user_id, title, url, favicon, deleted_at, created_at, updated_at)
         VALUES ('bm-1', ?, 'trash', 'https://example.com/a', ?, ?, ?, ?)`,
      )
      .run(USER, ASSET_PATH, now, now, now)
    h.sqlite
      .prepare(
        `INSERT INTO bookmarks (id, user_id, title, url, favicon, created_at, updated_at)
         VALUES ('bm-2', 'user-2', 'live', 'https://example.com/b', ?, ?, ?)`,
      )
      .run(ASSET_PATH, now, now)
    h.sqlite.prepare('INSERT INTO users (id, username, password_hash) VALUES (?, ?, ?)').run('user-2', 'user-2', 'x')

    const result = await permanentDeleteBookmark(h.db, 'bm-1', USER)

    expect(result.success).toBe(true)
    expect(result.orphanedStorageKeys).toEqual([])
    expect(h.sqlite.prepare('SELECT COUNT(*) AS n FROM storage_cleanup_jobs').get()).toEqual({ n: 0 })
  })

  it('deletes a due snapshot job and removes it after R2 succeeds', async () => {
    const h = db()
    const bucket = r2()
    const key = 'snapshots/u/bm-1/one.html'
    enqueue(h, key, 'snapshot')

    const result = await drainStorageCleanupJobs({ DB: h.db, SNAPSHOTS: bucket.binding }, { now: new Date(NOW) })

    expect(result).toEqual({ processed: 1, deleted: 1, skippedReferenced: 0, failed: 0 })
    expect(h.sqlite.prepare('SELECT COUNT(*) AS n FROM storage_cleanup_jobs').get()).toEqual({ n: 0 })
  })

  it('records a failed delete with attempts and exponential retry', async () => {
    const h = db()
    const bucket = r2({ failDelete: true })
    const key = 'snapshots/u/bm-1/one.html'
    enqueue(h, key, 'snapshot')

    const result = await drainStorageCleanupJobs({ DB: h.db, SNAPSHOTS: bucket.binding }, { now: new Date(NOW) })

    expect(result).toEqual({ processed: 1, deleted: 0, skippedReferenced: 0, failed: 1 })
    expect(job(h, key)).toMatchObject({ attempts: 1, last_error: 'R2 unavailable' })
    expect(job(h, key).next_retry_at).toBe('2026-01-01T00:00:01.000Z')
  })

  it('dead-letters a permanently failing key: final attempt records the state, later drains skip it entirely (R5-P3)', async () => {
    const h = db()
    const bucket = r2({ failDelete: true })
    const key = 'snapshots/u/bm-1/one.html'
    enqueue(h, key, 'snapshot')
    // One attempt short of the dead-letter threshold.
    h.sqlite.prepare('UPDATE storage_cleanup_jobs SET attempts = 23 WHERE storage_key = ?').run(key)

    const first = await drainStorageCleanupJobs({ DB: h.db, SNAPSHOTS: bucket.binding }, { now: new Date(NOW) })
    expect(first).toEqual({ processed: 1, deleted: 0, skippedReferenced: 0, failed: 1 })
    // The terminal write records attempts=24 and keeps the row for inspection.
    expect(job(h, key)).toMatchObject({ attempts: 24, last_error: 'R2 unavailable' })
    const row = h.sqlite.prepare('SELECT next_retry_at FROM storage_cleanup_jobs WHERE storage_key = ?').get(key) as { next_retry_at: string }
    // The dead-letter branch does NOT reschedule (the attempts filter owns exclusion).
    expect(row.next_retry_at).toBe(NOW)

    // Every later drain excludes the dead row: zero processing, zero writes.
    const second = await drainStorageCleanupJobs({ DB: h.db, SNAPSHOTS: bucket.binding }, { now: new Date(NOW) })
    expect(second).toEqual({ processed: 0, deleted: 0, skippedReferenced: 0, failed: 0 })
    expect(job(h, key).attempts).toBe(24)
  })

  it('rechecks asset references immediately before deleting a shared hash', async () => {
    const h = db()
    const bucket = r2()
    const key = `assets/favicon/${ASSET_HASH}`
    enqueue(h, key, 'asset')
    const now = new Date().toISOString()
    h.sqlite
      .prepare(
        `INSERT INTO bookmarks (id, user_id, title, url, favicon, created_at, updated_at)
         VALUES ('bm-live', 'user-2', 'live', 'https://example.com/live', ?, ?, ?)`,
      )
      .run(ASSET_PATH, now, now)

    const result = await drainStorageCleanupJobs({ DB: h.db, SNAPSHOTS: bucket.binding }, { now: new Date(NOW) })

    expect(result).toEqual({ processed: 1, deleted: 0, skippedReferenced: 1, failed: 0 })
    expect(bucket.store.has(key)).toBe(false)
    expect(h.sqlite.prepare('SELECT COUNT(*) AS n FROM storage_cleanup_jobs').get()).toEqual({ n: 0 })
  })

  it('migration gate requires the durable cleanup table', async () => {
    const h = db()
    await expect(checkMigrationsApplied(h.db)).resolves.toEqual({ ok: true })
    h.sqlite.exec('DROP TABLE storage_cleanup_jobs')
    const result = await checkMigrationsApplied(h.db)
    expect(result.ok).toBe(false)
    expect(result.ok ? '' : result.error).toContain('storage_cleanup_jobs')
  })
})
