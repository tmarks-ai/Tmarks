import { afterEach, describe, expect, it, vi } from 'vitest'
import { persistBookmarkImages, isAssetPath, assetPath } from '../src/lib/bookmarks/asset-persist'
import { collectOrphanedAssetKeysBeforeDelete } from '../src/lib/storage-cleanup'
import { createSqliteD1, type SqliteD1Harness } from './helpers/sqlite-d1'
import { r2, seedBookmark } from './helpers/asset-test-utils'
import type { Env } from '../src/lib/env'

const USER = 'user-1'

let harness: SqliteD1Harness | null = null

function db(): SqliteD1Harness {
  harness = createSqliteD1(USER)
  return harness
}

afterEach(() => {
  harness?.close()
  harness = null
  vi.unstubAllGlobals()
})

describe('persistBookmarkImages', () => {
  function row(h: SqliteD1Harness, id: string) {
    return h.sqlite
      .prepare('SELECT favicon, cover_image FROM bookmarks WHERE id = ?')
      .get(id) as { favicon: string | null; cover_image: string | null }
  }

  function stubFetch(responses: Array<{ url: string; body: Uint8Array; contentType: string }>) {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request) => {
        const url = String(input)
        const hit = responses.find((r) => r.url === url)
        if (!hit) return new Response('not found', { status: 404 })
        return new Response(hit.body, { headers: { 'content-type': hit.contentType } })
      }),
    )
  }

  function syncChangeCount(h: SqliteD1Harness, id: string) {
    return h.sqlite
      .prepare(`SELECT COUNT(*) AS n FROM sync_changes WHERE entity_type = 'bookmark' AND entity_id = ?`)
      .get(id) as { n: number }
  }

  it('downloads images, stores them content-addressed and rewrites the bookmark row', async () => {
    const h = db()
    const bucket = r2()
    seedBookmark(h, USER, 'bm-1', 'https://cdn.example.com/icon.png', 'https://cdn.example.com/cover.jpg')
    stubFetch([
      { url: 'https://cdn.example.com/icon.png', body: new Uint8Array([9, 9]), contentType: 'image/png' },
      { url: 'https://cdn.example.com/cover.jpg', body: new Uint8Array([7, 7, 7]), contentType: 'image/jpeg' },
    ])

    const env = { DB: h.db, SNAPSHOTS: bucket.binding } as Pick<Env, 'DB' | 'SNAPSHOTS'>
    await persistBookmarkImages(env, USER, 'bm-1', 'https://cdn.example.com/icon.png', 'https://cdn.example.com/cover.jpg')

    const { favicon, cover_image } = row(h, 'bm-1')
    expect(isAssetPath(favicon)).toBe(true)
    expect(isAssetPath(cover_image)).toBe(true)
    // Rewritten to the PUBLIC route: <img> tags cannot carry a Bearer header.
    expect(favicon!.startsWith('/api/public/assets/')).toBe(true)
    // Objects stored under their content hash, exactly one per kind.
    expect([...bucket.store.keys()].filter((k) => k.startsWith('assets/favicon/'))).toHaveLength(1)
    expect([...bucket.store.keys()].filter((k) => k.startsWith('assets/cover/'))).toHaveLength(1)
    // The extension's incremental pull sees the rewrite.
    expect(syncChangeCount(h, 'bm-1').n).toBe(1)
  })

  it('does not overwrite fields changed or cleared while the download is in flight', async () => {
    const h = db()
    const bucket = r2()
    seedBookmark(h, USER, 'bm-race', 'https://cdn.example.com/old-icon.png', 'https://cdn.example.com/old-cover.jpg')
    let userUpdateApplied = false
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        if (!userUpdateApplied) {
          userUpdateApplied = true
          h.sqlite
            .prepare('UPDATE bookmarks SET favicon = ?, cover_image = NULL WHERE id = ?')
            .run('https://cdn.example.com/user-icon.png', 'bm-race')
        }
        return new Response(new Uint8Array([4, 4]), { headers: { 'content-type': 'image/png' } })
      }),
    )

    const env = { DB: h.db, SNAPSHOTS: bucket.binding } as Pick<Env, 'DB' | 'SNAPSHOTS'>
    await persistBookmarkImages(
      env,
      USER,
      'bm-race',
      'https://cdn.example.com/old-icon.png',
      'https://cdn.example.com/old-cover.jpg',
    )

    expect(row(h, 'bm-race')).toEqual({
      favicon: 'https://cdn.example.com/user-icon.png',
      cover_image: null,
    })
    expect(syncChangeCount(h, 'bm-race').n).toBe(0)
  })

  it('writes a still-current field without overwriting a concurrently changed sibling', async () => {
    const h = db()
    const bucket = r2()
    seedBookmark(h, USER, 'bm-partial', 'https://cdn.example.com/old-icon.png', 'https://cdn.example.com/current-cover.jpg')
    let userUpdateApplied = false
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request) => {
        if (!userUpdateApplied) {
          userUpdateApplied = true
          h.sqlite
            .prepare('UPDATE bookmarks SET favicon = ? WHERE id = ?')
            .run('https://cdn.example.com/user-icon.png', 'bm-partial')
        }
        return new Response(new Uint8Array(String(input).includes('cover') ? [7] : [8]), {
          headers: { 'content-type': 'image/png' },
        })
      }),
    )

    const env = { DB: h.db, SNAPSHOTS: bucket.binding } as Pick<Env, 'DB' | 'SNAPSHOTS'>
    await persistBookmarkImages(
      env,
      USER,
      'bm-partial',
      'https://cdn.example.com/old-icon.png',
      'https://cdn.example.com/current-cover.jpg',
    )

    const updated = row(h, 'bm-partial')
    expect(updated.favicon).toBe('https://cdn.example.com/user-icon.png')
    expect(isAssetPath(updated.cover_image)).toBe(true)
    expect(syncChangeCount(h, 'bm-partial').n).toBe(1)
  })

  it('keeps remote URLs when the download fails or is not an image', async () => {
    const h = db()
    const bucket = r2()
    seedBookmark(h, USER, 'bm-2')
    stubFetch([
      { url: 'https://cdn.example.com/text', body: new Uint8Array([1]), contentType: 'text/html' },
    ])

    const env = { DB: h.db, SNAPSHOTS: bucket.binding } as Pick<Env, 'DB' | 'SNAPSHOTS'>
    await persistBookmarkImages(env, USER, 'bm-2', 'https://cdn.example.com/404.png', 'https://cdn.example.com/text')

    expect(row(h, 'bm-2')).toEqual({ favicon: null, cover_image: null })
    expect(bucket.store.size).toBe(0)
  })

  it('skips fields that already point at asset paths (idempotent re-save)', async () => {
    const h = db()
    const bucket = r2()
    seedBookmark(h, USER, 'bm-3')

    const env = { DB: h.db, SNAPSHOTS: bucket.binding } as Pick<Env, 'DB' | 'SNAPSHOTS'>
    await persistBookmarkImages(env, USER, 'bm-3', assetPath('favicon', 'b'.repeat(64)), null)

    expect(bucket.store.size).toBe(0)
    expect(row(h, 'bm-3')).toEqual({ favicon: null, cover_image: null })
  })

  it('refuses image/svg+xml responses (script execution surface)', async () => {
    const h = db()
    const bucket = r2()
    seedBookmark(h, USER, 'bm-svg')
    stubFetch([
      { url: 'https://cdn.example.com/icon.svg', body: new Uint8Array([1]), contentType: 'image/svg+xml' },
    ])

    const env = { DB: h.db, SNAPSHOTS: bucket.binding } as Pick<Env, 'DB' | 'SNAPSHOTS'>
    await persistBookmarkImages(env, USER, 'bm-svg', 'https://cdn.example.com/icon.svg', null)

    expect(bucket.store.size).toBe(0)
    expect(row(h, 'bm-svg')).toEqual({ favicon: null, cover_image: null })
  })

  it('does not resurrect a concurrently deleted bookmark row', async () => {
    const h = db()
    const bucket = r2()
    seedBookmark(h, USER, 'bm-dead')
    // Simulate the user trashing + purging the bookmark before the background
    // write-back lands.
    h.sqlite.prepare('UPDATE bookmarks SET deleted_at = ? WHERE id = ?').run(new Date().toISOString(), 'bm-dead')
    stubFetch([
      { url: 'https://cdn.example.com/icon.png', body: new Uint8Array([9]), contentType: 'image/png' },
    ])

    const env = { DB: h.db, SNAPSHOTS: bucket.binding } as Pick<Env, 'DB' | 'SNAPSHOTS'>
    await persistBookmarkImages(env, USER, 'bm-dead', 'https://cdn.example.com/icon.png', null)

    expect(row(h, 'bm-dead').favicon).toBeNull()
  })

  // R8 BL-9: the old collectOrphanedAssetKeys (no exclude semantics, dead
  // production code — this was its only consumer) is deleted; the test now
  // covers the live successor with its exclude predicate.
  it('orphan discovery keeps hashes still referenced by surviving rows, drops unreferenced ones', async () => {
    const h = db()
    const shared = assetPath('favicon', 'c'.repeat(64))
    const unique = assetPath('cover', 'd'.repeat(64))
    h.sqlite
      .prepare(`INSERT INTO bookmarks (id, user_id, title, url, favicon, cover_image, created_at, updated_at) VALUES (?, ?, 't', 'https://example.com/b', ?, NULL, ?, ?)`)
      .run('bm-keep', USER, shared, new Date().toISOString(), new Date().toISOString())

    // The row being deleted (bm-dead, excluded from the scan) owned both;
    // only the shared one survives via bm-keep.
    const keys = await collectOrphanedAssetKeysBeforeDelete(
      h.db,
      [shared, unique, 'https://not-an-asset.example/x', null],
      { excludeBookmarkIds: ['bm-dead'] },
    )
    expect(keys).toEqual([`assets/cover/${'d'.repeat(64)}`])

    // Once the last reference is gone, the shared hash becomes garbage too.
    h.sqlite.prepare(`DELETE FROM bookmarks WHERE id = 'bm-keep'`).run()
    const keys2 = await collectOrphanedAssetKeysBeforeDelete(h.db, [shared], { excludeBookmarkIds: ['bm-dead'] })
    expect(keys2).toEqual([`assets/favicon/${'c'.repeat(64)}`])
  })
})
