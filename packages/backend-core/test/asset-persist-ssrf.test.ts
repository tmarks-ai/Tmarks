import { afterEach, describe, expect, it, vi } from 'vitest'
import { persistBookmarkImages } from '../src/lib/bookmarks/asset-persist'
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

describe('persistBookmarkImages network hardening (SSRF & redirects)', () => {
  /** Stub that answers the first URL with a 30x Location, then serves the target. */
  function stubRedirectFetch(from: string, location: string, target: { body: Uint8Array; contentType: string }) {
    const seen: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input)
        seen.push(url)
        expect(init?.redirect).toBe('manual')
        if (url === from) return new Response(null, { status: 302, headers: { location } })
        return new Response(target.body, { headers: { 'content-type': target.contentType } })
      }),
    )
    return seen
  }

  function faviconColumn(h: SqliteD1Harness, id: string) {
    return h.sqlite
      .prepare('SELECT favicon, cover_image FROM bookmarks WHERE id = ?')
      .get(id) as { favicon: string | null; cover_image: string | null }
  }

  // SSRF regression: the pre-fix fetch used redirect:'follow', so an og:image
  // pointed at an internal address was fetched and copied into public R2.
  it('never fetches an internal-network image URL', async () => {
    const h = db()
    const bucket = r2()
    seedBookmark(h, USER, 'bm-ssrf-1')
    const seen = stubRedirectFetch('http://169.254.169.254/img', '', { body: new Uint8Array([1]), contentType: 'image/png' })

    const env = { DB: h.db, SNAPSHOTS: bucket.binding } as Pick<Env, 'DB' | 'SNAPSHOTS'>
    await persistBookmarkImages(env, USER, 'bm-ssrf-1', 'http://169.254.169.254/img', null)

    expect(seen).toEqual([])
    expect(bucket.store.size).toBe(0)
    expect(faviconColumn(h, 'bm-ssrf-1')).toEqual({ favicon: null, cover_image: null })
  })

  it('keeps the remote URL when a public image URL redirects into a private address', async () => {
    const h = db()
    const bucket = r2()
    seedBookmark(h, USER, 'bm-ssrf-2')
    const seen = stubRedirectFetch(
      'https://attacker.example/og.png',
      'http://127.0.0.1:8080/internal.png',
      { body: new Uint8Array([1]), contentType: 'image/png' },
    )

    const env = { DB: h.db, SNAPSHOTS: bucket.binding } as Pick<Env, 'DB' | 'SNAPSHOTS'>
    await persistBookmarkImages(env, USER, 'bm-ssrf-2', 'https://attacker.example/og.png', null)

    // Only the public hop was issued; the internal target was never fetched.
    expect(seen).toEqual(['https://attacker.example/og.png'])
    expect(bucket.store.size).toBe(0)
    expect(faviconColumn(h, 'bm-ssrf-2')).toEqual({ favicon: null, cover_image: null })
  })

  it('follows a legitimate public redirect and persists the redirected image', async () => {
    const h = db()
    const bucket = r2()
    seedBookmark(h, USER, 'bm-redir', 'https://example.com/icon.png')
    const seen = stubRedirectFetch(
      'https://example.com/icon.png',
      'https://cdn.example.com/real-icon.png',
      { body: new Uint8Array([5, 5]), contentType: 'image/png' },
    )

    const env = { DB: h.db, SNAPSHOTS: bucket.binding } as Pick<Env, 'DB' | 'SNAPSHOTS'>
    await persistBookmarkImages(env, USER, 'bm-redir', 'https://example.com/icon.png', null)

    expect(seen).toEqual(['https://example.com/icon.png', 'https://cdn.example.com/real-icon.png'])
    expect(faviconColumn(h, 'bm-redir').favicon).toMatch(/^\/api\/public\/assets\/favicon\/[0-9a-f]{64}$/)
    expect(bucket.store.size).toBe(1)
  })
})
