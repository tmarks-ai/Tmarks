import { describe, expect, it } from 'vitest'
import { createMigratedDatabase, type SqliteDatabase } from './helpers/sqlite-migrations'

/**
 * tags.bookmark_count is a maintained counter (triggers in sql/04_tags.sql),
 * and GET /tags reads it directly.
 * These tests pin the invariant: the counter must equal a live
 * COUNT(DISTINCT bookmark) at every mutation boundary, so no write path can
 * ship drift.
 */
describe('maintained tag bookmark_count', () => {
  const USER = 'user-1'
  const OTHER = 'user-2'

  function freshDb(): SqliteDatabase {
    return createMigratedDatabase()
  }

  function seedUser(db: SqliteDatabase, id: string): void {
    db.prepare('INSERT INTO users (id, username, email, password_hash, created_at, updated_at) VALUES (?, ?, ?, ?, datetime(\'now\'), datetime(\'now\'))').run(id, `u-${id}`, `${id}@example.com`, 'x')
  }

  function seedTag(db: SqliteDatabase, id: string, userId: string, name: string): void {
    db.prepare('INSERT INTO tags (id, user_id, name, created_at, updated_at) VALUES (?, ?, ?, datetime(\'now\'), datetime(\'now\'))').run(id, userId, name)
  }

  function seedBookmark(db: SqliteDatabase, id: string, userId: string, url: string): void {
    db.prepare(`INSERT INTO bookmarks (id, user_id, title, url, created_at, updated_at)
                VALUES (?, ?, 't', ?, datetime('now'), datetime('now'))`).run(id, userId, url)
  }

  function link(db: SqliteDatabase, bookmarkId: string, tagId: string, userId: string): void {
    db.prepare('INSERT INTO bookmark_tags (bookmark_id, tag_id, user_id, created_at) VALUES (?, ?, ?, datetime(\'now\'))').run(bookmarkId, tagId, userId)
  }

  function unlink(db: SqliteDatabase, bookmarkId: string, tagId: string, userId: string): void {
    db.prepare('DELETE FROM bookmark_tags WHERE bookmark_id = ? AND tag_id = ? AND user_id = ?').run(bookmarkId, tagId, userId)
  }

  function tagCount(db: SqliteDatabase, tagId: string): number {
    const row = db.prepare('SELECT bookmark_count FROM tags WHERE id = ?').get(tagId) as { bookmark_count: number }
    return Number(row.bookmark_count)
  }

  function liveAggregate(db: SqliteDatabase, tagId: string, userId: string): number {
    const row = db.prepare(
      `SELECT COUNT(DISTINCT b.id) AS n
       FROM bookmark_tags bt JOIN bookmarks b ON b.id = bt.bookmark_id
       WHERE bt.tag_id = ? AND bt.user_id = ? AND b.deleted_at IS NULL`
    ).get(tagId, userId) as { n: number }
    return Number(row.n)
  }

  it('increments on link insert and decrements on link delete', () => {
    const db = freshDb()
    seedUser(db, USER)
    seedTag(db, 'tag-1', USER, 'linux')
    seedBookmark(db, 'bm-1', USER, 'https://example.com/1')
    seedBookmark(db, 'bm-2', USER, 'https://example.com/2')

    link(db, 'bm-1', 'tag-1', USER)
    expect(tagCount(db, 'tag-1')).toBe(1)
    link(db, 'bm-2', 'tag-1', USER)
    expect(tagCount(db, 'tag-1')).toBe(2)
    expect(liveAggregate(db, 'tag-1', USER)).toBe(2)

    unlink(db, 'bm-1', 'tag-1', USER)
    expect(tagCount(db, 'tag-1')).toBe(1)
    expect(liveAggregate(db, 'tag-1', USER)).toBe(1)
    db.close()
  })

  it('does not count links created while the bookmark is in the trash', () => {
    const db = freshDb()
    seedUser(db, USER)
    seedTag(db, 'tag-1', USER, 'linux')
    seedBookmark(db, 'bm-1', USER, 'https://example.com/1')

    db.prepare(`UPDATE bookmarks SET deleted_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`).run('bm-1')
    link(db, 'bm-1', 'tag-1', USER)
    expect(tagCount(db, 'tag-1')).toBe(0)

    db.prepare('UPDATE bookmarks SET deleted_at = NULL, updated_at = datetime(\'now\') WHERE id = ?').run('bm-1')
    expect(tagCount(db, 'tag-1')).toBe(1)
    db.close()
  })

  it('decrements on trash and re-increments on restore', () => {
    const db = freshDb()
    seedUser(db, USER)
    seedTag(db, 'tag-1', USER, 'linux')
    seedTag(db, 'tag-2', USER, 'rust')
    seedBookmark(db, 'bm-1', USER, 'https://example.com/1')

    link(db, 'bm-1', 'tag-1', USER)
    link(db, 'bm-1', 'tag-2', USER)
    expect(tagCount(db, 'tag-1')).toBe(1)
    expect(tagCount(db, 'tag-2')).toBe(1)

    db.prepare(`UPDATE bookmarks SET deleted_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`).run('bm-1')
    expect(tagCount(db, 'tag-1')).toBe(0)
    expect(tagCount(db, 'tag-2')).toBe(0)
    expect(liveAggregate(db, 'tag-1', USER)).toBe(0)

    db.prepare('UPDATE bookmarks SET deleted_at = NULL, updated_at = datetime(\'now\') WHERE id = ?').run('bm-1')
    expect(tagCount(db, 'tag-1')).toBe(1)
    expect(tagCount(db, 'tag-2')).toBe(1)
    expect(liveAggregate(db, 'tag-1', USER)).toBe(1)
    db.close()
  })

  it('never lets the counter go below zero', () => {
    const db = freshDb()
    seedUser(db, USER)
    seedTag(db, 'tag-1', USER, 'linux')
    seedBookmark(db, 'bm-1', USER, 'https://example.com/1')
    link(db, 'bm-1', 'tag-1', USER)
    unlink(db, 'bm-1', 'tag-1', USER)
    unlink(db, 'bm-1', 'tag-1', USER) // second delete affects no rows; guard still holds
    expect(tagCount(db, 'tag-1')).toBe(0)
    db.close()
  })

  it('scopes maintained counts per tag and user', () => {
    const db = freshDb()
    seedUser(db, USER)
    seedUser(db, OTHER)
    seedTag(db, 'tag-1', USER, 'linux')
    seedTag(db, 'tag-9', OTHER, 'linux')
    seedBookmark(db, 'bm-1', USER, 'https://example.com/1')
    seedBookmark(db, 'bm-9', OTHER, 'https://example.com/9')

    link(db, 'bm-1', 'tag-1', USER)
    link(db, 'bm-9', 'tag-9', OTHER)
    expect(tagCount(db, 'tag-1')).toBe(1)
    expect(tagCount(db, 'tag-9')).toBe(1)
    db.close()
  })

  it('recomputes the frozen counter when a REST-deleted tag is restored', () => {
    const db = freshDb()
    seedUser(db, USER)
    seedTag(db, 'tag-1', USER, 'linux')
    seedBookmark(db, 'bm-1', USER, 'https://example.com/1')
    link(db, 'bm-1', 'tag-1', USER)
    expect(tagCount(db, 'tag-1')).toBe(1)

    // REST DELETE /tags/:id order: tombstone first, THEN detach links — the
    // delete trigger skips the already-trashed tag, so the counter freezes at
    // its pre-delete value even though the links are gone.
    db.prepare("UPDATE tags SET deleted_at = datetime('now'), updated_at = datetime('now') WHERE id = ?").run('tag-1')
    db.prepare('DELETE FROM bookmark_tags WHERE tag_id = ? AND user_id = ?').run('tag-1', USER)
    expect(tagCount(db, 'tag-1')).toBe(1)

    // Restore (sync-plane name-match resurrect, or applyTagOperation upsert):
    // the counter must come back recomputed from live links, not frozen.
    db.prepare("UPDATE tags SET deleted_at = NULL, updated_at = datetime('now') WHERE id = ?").run('tag-1')
    expect(tagCount(db, 'tag-1')).toBe(0)
    db.close()
  })

  it('heals drift that accrued while a sync-deleted tag was tombstoned', () => {
    const db = freshDb()
    seedUser(db, USER)
    seedTag(db, 'tag-1', USER, 'linux')
    seedBookmark(db, 'bm-1', USER, 'https://example.com/1')
    link(db, 'bm-1', 'tag-1', USER)
    expect(tagCount(db, 'tag-1')).toBe(1)

    // Sync-plane tag delete: tombstone only, links survive. Counter frozen.
    db.prepare("UPDATE tags SET deleted_at = datetime('now'), updated_at = datetime('now') WHERE id = ?").run('tag-1')
    // During the window the bookmark is trashed: the bookmark trigger skips
    // the trashed tag, so the frozen counter drifts from the live truth.
    db.prepare("UPDATE bookmarks SET deleted_at = datetime('now'), updated_at = datetime('now') WHERE id = ?").run('bm-1')
    expect(tagCount(db, 'tag-1')).toBe(1)
    expect(liveAggregate(db, 'tag-1', USER)).toBe(0)

    // Restore: recomputed from live links — the window's drift heals.
    db.prepare("UPDATE tags SET deleted_at = NULL, updated_at = datetime('now') WHERE id = ?").run('tag-1')
    expect(tagCount(db, 'tag-1')).toBe(0)

    // And the invariant holds for mutations after the restore.
    db.prepare("UPDATE bookmarks SET deleted_at = NULL, updated_at = datetime('now') WHERE id = ?").run('bm-1')
    expect(tagCount(db, 'tag-1')).toBe(1)
    expect(liveAggregate(db, 'tag-1', USER)).toBe(1)
    db.close()
  })
})

