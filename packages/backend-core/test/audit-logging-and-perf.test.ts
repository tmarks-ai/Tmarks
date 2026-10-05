import { afterEach, describe, expect, it } from 'vitest'
import { sanitizeLogUrl } from '../src/middleware/request-logger'
import { emitSyncChanges } from '../src/lib/sync/sync-emit'
import { fetchFolderPathMap } from '../src/lib/bookmarks/folders-path'
import { createSqliteD1, type SqliteD1Harness } from './helpers/sqlite-d1'

const USER = 'user-1'

let harness: SqliteD1Harness | null = null

function db(): SqliteD1Harness {
  harness = createSqliteD1(USER)
  return harness
}

afterEach(() => {
  harness?.close()
  harness = null
})

describe('request log URL redaction', () => {
  it('redacts the public-share slug from the pathname (it is the only secret)', () => {
    const logged = sanitizeLogUrl('https://app.example.com/api/public/share/Ab3xY9zQ2wLmN4pR?sig=1')
    expect(logged).not.toContain('Ab3xY9zQ2wLmN4pR')
    expect(logged).toContain('/api/public/share/***')
    expect(logged).toContain('sig=***')
  })

  it('redacts user-content query params: search keywords and bookmark URLs', () => {
    expect(sanitizeLogUrl('https://app.example.com/api/v1/search?q=my-private-search')).toContain('q=***')
    expect(sanitizeLogUrl('https://app.example.com/api/v1/bookmarks?keyword=tokensearch')).toContain('keyword=***')
    expect(
      sanitizeLogUrl('https://app.example.com/api/v1/bookmarks/check-url?url=https://site.com/reset?token=abc')
    ).toContain('url=***')
  })

  it('leaves ordinary API paths untouched', () => {
    expect(sanitizeLogUrl('https://app.example.com/api/v1/bookmarks?page_size=100')).toBe(
      'https://app.example.com/api/v1/bookmarks?page_size=100'
    )
  })
})

describe('bulk emitSyncChanges (bookmark fast path)', () => {
  function seed(h: SqliteD1Harness, id: string, url: string, tag: string) {
    const now = new Date().toISOString()
    h.sqlite
      .prepare(`INSERT INTO bookmarks (id, user_id, title, url, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`)
      .run(id, USER, `t-${id}`, url, now, now)
    // tags.name is UNIQUE per user — seed one distinct tag per bookmark.
    h.sqlite.prepare(`INSERT INTO tags (id, user_id, name) VALUES (?, ?, ?)`).run(`tag-${id}`, USER, tag)
    h.sqlite
      .prepare(`INSERT INTO bookmark_tags (bookmark_id, tag_id, user_id) VALUES (?, ?, ?)`)
      .run(id, `tag-${id}`, USER)
  }

  it('records one change row per id with the NEW revision embedded in the payload', async () => {
    const h = db()
    seed(h, 'bm-1', 'https://example.com/1', 'ai')
    seed(h, 'bm-2', 'https://example.com/2', 'tools')
    seed(h, 'bm-3', 'https://example.com/3', 'dev')

    await emitSyncChanges(h.db, USER, 'bookmark', ['bm-1', 'bm-2', 'bm-3'], 'delete')

    const changes = h.sqlite
      .prepare(`SELECT entity_id, revision, payload_json FROM sync_changes ORDER BY entity_id`)
      .all() as Array<{ entity_id: string; revision: string; payload_json: string }>
    expect(changes).toHaveLength(3)

    for (const change of changes) {
      const payload = JSON.parse(change.payload_json) as { revision: string; tags: Array<{ name: string }>; url: string }
      // Sequential path re-reads the row AFTER the revision UPDATE, so the
      // embedded revision must equal the change revision.
      expect(payload.revision).toBe(change.revision)
      expect(payload.url).toBe(`https://example.com/${change.entity_id.slice(-1)}`)
      expect(payload.tags).toHaveLength(1)

      const row = h.sqlite
        .prepare('SELECT revision FROM bookmarks WHERE id = ?')
        .get(change.entity_id) as { revision: string }
      expect(row.revision).toBe(change.revision)
    }
  })

  it('keeps null payloads for ids whose rows are gone (hard delete)', async () => {
    const h = db()
    seed(h, 'bm-gone', 'https://example.com/x', 'ai')
    h.sqlite.prepare('DELETE FROM bookmarks WHERE id = ?').run('bm-gone')

    await emitSyncChanges(h.db, USER, 'bookmark', ['bm-gone'], 'delete')

    const change = h.sqlite
      .prepare(`SELECT payload_json FROM sync_changes WHERE entity_id = 'bm-gone'`)
      .get() as { payload_json: string }
    expect(change.payload_json).toBe('null')
  })
})

describe('fetchFolderPathMap', () => {
  it('resolves two-level paths for every distinct folder in one read', async () => {
    const h = db()
    const now = new Date().toISOString()
    h.sqlite
      .prepare(`INSERT INTO bookmark_folders (id, user_id, name, parent_id) VALUES (?, ?, ?, NULL)`)
      .run('f-root', USER, 'root')
    h.sqlite
      .prepare(`INSERT INTO bookmark_folders (id, user_id, name, parent_id) VALUES (?, ?, ?, ?)`)
      .run('f-child', USER, 'child', 'f-root')
    // Another user's folder must not leak into the map (parent row first —
    // the harness enforces the users FK since R8 IN-1).
    h.sqlite
      .prepare(`INSERT INTO users (id, username, password_hash) VALUES ('user-2', 'user-2', 'x')`)
      .run()
    h.sqlite
      .prepare(`INSERT INTO bookmark_folders (id, user_id, name, parent_id) VALUES (?, ?, ?, NULL)`)
      .run('f-other', 'user-2', 'other')

    const map = await fetchFolderPathMap(h.db, USER, ['f-root', 'f-child', 'f-child', null, undefined, 'f-other', 'f-missing'])

    expect(map.get('f-root')).toEqual(['root'])
    expect(map.get('f-child')).toEqual(['root', 'child'])
    expect(map.has('f-other')).toBe(false)
    expect(map.has('f-missing')).toBe(false)
    expect(map.size).toBe(2)
    void now
  })
})
