import { Hono } from 'hono'
import { afterEach, describe, expect, it } from 'vitest'
import { rotateRefreshSession } from '@tmarks/backend-core'
import { fetchPublicSharePage } from '../src/lib/share/public-share'
import { groupItemsBatchAddHandler } from '../src/routes/tab-groups/group-items-batch'
import { createSqliteD1, type SqliteD1Harness } from './helpers/sqlite-d1'
import type { AppEnv } from '../src/lib/env'

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

function iso(offsetMs: number): string {
  return new Date(Date.now() + offsetMs).toISOString()
}

interface TokenRow {
  id: number
  user_id: string
  session_id: string | null
  revoked_at: string | null
}

function insertTokenRow(h: SqliteD1Harness, overrides: Partial<TokenRow> & { user_id?: string } = {}): number {
  const row = {
    user_id: USER,
    refresh_token_hash: `hash-${Math.random().toString(36).slice(2)}`,
    session_id: 'sess-1',
    revoked_at: null as string | null,
    ...overrides,
  }
  const result = h.sqlite
    .prepare(
      `INSERT INTO auth_tokens (user_id, refresh_token_hash, session_id, expires_at, created_at, remember_me, revoked_at)
       VALUES (?, ?, ?, ?, ?, 0, ?)`
    )
    .run(row.user_id, row.refresh_token_hash, row.session_id, iso(60_000), iso(0), row.revoked_at) as {
    lastInsertRowid?: number | bigint
  }
  return Number(result.lastInsertRowid)
}

function rotationInput(h: SqliteD1Harness, tokenId: number, suffix: string) {
  return {
    db: h.db,
    tokenId,
    userId: USER,
    refreshTokenHash: `next-hash-${suffix}`,
    sessionId: 'sess-1',
    expiresAt: iso(7 * 24 * 3600_000),
    createdAt: iso(0),
    rememberMe: false,
  }
}

describe('refresh token rotation claim', () => {
  it('revokes the presented row and inserts exactly one successor on success', async () => {
    const h = db()
    const tokenId = insertTokenRow(h)

    const rotated = await rotateRefreshSession(rotationInput(h, tokenId, 'a'))

    expect(rotated).toBe(true)
    const rows = h.sqlite.prepare('SELECT id, revoked_at FROM auth_tokens ORDER BY id').all() as Array<{
      id: number
      revoked_at: string | null
    }>
    expect(rows).toHaveLength(2)
    expect(rows[0]!.revoked_at).not.toBeNull()
    expect(rows[1]!.revoked_at).toBeNull()
  })

  it('the loser of a concurrent replay mints no successor (regression: reuse detection bypass)', async () => {
    // Both requests read the row as non-revoked and pass the handler checks;
    // only the claim UPDATE can break the tie. Before the meta.changes check,
    // both batches ran their INSERT and two successor chains existed under one
    // session_id, so replaying a stolen refresh token never tripped the
    // revoked-row reuse detection.
    const h = db()
    const tokenId = insertTokenRow(h)

    const first = await rotateRefreshSession(rotationInput(h, tokenId, 'first'))
    const loser = await rotateRefreshSession(rotationInput(h, tokenId, 'loser'))

    expect(first).toBe(true)
    expect(loser).toBe(false)
    const successors = h.sqlite
      .prepare(`SELECT COUNT(*) AS n FROM auth_tokens WHERE session_id = 'sess-1' AND revoked_at IS NULL`)
      .get() as { n: number }
    expect(successors.n).toBe(1)
  })

  it('purges only revoked rows older than the 7-day cutoff', async () => {
    const h = db()
    const tokenId = insertTokenRow(h)
    // A stale revoked row from 8 days ago — purge target.
    h.sqlite
      .prepare(
        `INSERT INTO auth_tokens (user_id, refresh_token_hash, session_id, expires_at, created_at, remember_me, revoked_at)
         VALUES (?, 'stale-hash', 'sess-old', ?, ?, 0, ?)`
      )
      .run(USER, iso(60_000), iso(-8 * 24 * 3600_000), iso(-8 * 24 * 3600_000))

    await rotateRefreshSession(rotationInput(h, tokenId, 'a'))

    const stale = h.sqlite
      .prepare(`SELECT COUNT(*) AS n FROM auth_tokens WHERE refresh_token_hash = 'stale-hash'`)
      .get() as { n: number }
    expect(stale.n).toBe(0)
    const survivors = h.sqlite.prepare('SELECT COUNT(*) AS n FROM auth_tokens').get() as { n: number }
    expect(survivors.n).toBe(2) // just-revoked row + fresh successor
  })
})

describe('tab group batch add cap', () => {
  function mountBatchAdd(h: SqliteD1Harness): (body: unknown) => Promise<Response> {
    const app = new Hono<AppEnv>()
    app.post(
      '/tab-groups/:id/items/batch',
      async (c, next) => {
        c.set('auth', { user_id: USER, auth_type: 'jwt' })
        await next()
      },
      groupItemsBatchAddHandler
    )
    return (body) =>
      app.request(
        '/tab-groups/g-1/items/batch',
        { method: 'POST', body: JSON.stringify(body) },
        { DB: h.db } as AppEnv['Bindings']
      )
  }

  function seedGroup(h: SqliteD1Harness) {
    h.sqlite
      .prepare(`INSERT INTO tab_groups (id, user_id, title) VALUES ('g-1', ?, 'group')`)
      .run(USER)
  }

  it('rejects more than 100 items in one request', async () => {
    const h = db()
    seedGroup(h)
    const items = Array.from({ length: 101 }, (_, i) => ({ title: `t${i}`, url: `https://example.com/${i}` }))

    const res = await mountBatchAdd(h)({ items })

    expect(res.status).toBe(400)
    const inserted = h.sqlite.prepare('SELECT COUNT(*) AS n FROM tab_group_items').get() as { n: number }
    expect(inserted.n).toBe(0)
  })

  it('still accepts a batch at the cap boundary', async () => {
    const h = db()
    seedGroup(h)
    const items = Array.from({ length: 100 }, (_, i) => ({ title: `t${i}`, url: `https://example.com/${i}` }))

    const res = await mountBatchAdd(h)({ items })

    expect(res.status).toBe(200)
    const inserted = h.sqlite.prepare('SELECT COUNT(*) AS n FROM tab_group_items').get() as { n: number }
    expect(inserted.n).toBe(100)
  })
})

describe('public share response surface', () => {
  it('exposes only the public bookmark fields, not every DB column (regression: SELECT * spread)', async () => {
    const h = db()
    h.sqlite
      .prepare(
        `INSERT INTO public_share_pages (id, user_id, slug, enabled, created_at, updated_at)
         VALUES ('ps-1', ?, 'share-slug-abc123', 1, ?, ?)`
      )
      .run(USER, iso(0), iso(0))
    const insertBookmark = h.sqlite.prepare(
      `INSERT INTO bookmarks (id, user_id, title, url, normalized_url, is_private, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    insertBookmark.run('bm-pub', USER, 'public', 'https://example.com/a', 'example.com/a', 0, iso(0), iso(0))
    insertBookmark.run('bm-priv', USER, 'private', 'https://example.com/b', 'example.com/b', 1, iso(0), iso(0))
    h.sqlite
      .prepare(
        `INSERT INTO bookmark_folders (id, user_id, name, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run('folder-public', USER, 'Public folder', iso(0), iso(0))
    h.sqlite
      .prepare(
        `INSERT INTO bookmark_folders (id, user_id, name, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run('folder-private', USER, 'Private folder', iso(0), iso(0))
    h.sqlite.prepare('UPDATE bookmarks SET folder_id = ? WHERE id = ?').run('folder-public', 'bm-pub')
    h.sqlite.prepare('UPDATE bookmarks SET folder_id = ? WHERE id = ?').run('folder-private', 'bm-priv')

    const page = await fetchPublicSharePage(h.db, 'share-slug-abc123')

    expect(page).not.toBeNull()
    expect(page!.bookmarks).toHaveLength(1)
    expect(page!.folders?.map((folder) => folder.name)).toEqual(['Public folder'])
    const bookmark = page!.bookmarks[0]! as Record<string, unknown>
    // The DTO must carry exactly the public fields; DB-only columns
    // (normalized_url, user_id, deleted_at, is_private) must not leak through.
    expect(Object.keys(bookmark).sort()).toEqual(
      [
        'click_count', 'cover_image', 'created_at', 'description', 'favicon', 'folder_id', 'folder_path',
        'id', 'is_archived', 'is_pinned', 'is_todo', 'last_clicked_at', 'pin_order', 'position', 'revision',
        'tags', 'title', 'updated_at', 'url',
      ].sort()
    )
  })
})
