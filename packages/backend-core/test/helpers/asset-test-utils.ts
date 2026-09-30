import type { SqliteD1Harness } from './sqlite-d1'

/** Minimal R2 memory mock, shared by the asset test suites (was inlined per-suite). */
export function r2() {
  const store = new Map<string, { value: Uint8Array; contentType: string }>()
  return {
    store,
    binding: {
      async put(key: string, value: Uint8Array, options?: { httpMetadata?: { contentType?: string } }) {
        store.set(key, { value, contentType: options?.httpMetadata?.contentType || 'application/octet-stream' })
      },
      async get(key: string) {
        const hit = store.get(key)
        if (!hit) return null
        return {
          body: new Response(hit.value).body,
          httpMetadata: { contentType: hit.contentType },
        }
      },
      async delete(key: string) {
        store.delete(key)
      },
    } as unknown as R2Bucket,
  }
}

/** Seed a live bookmark row with optional favicon/cover. */
export function seedBookmark(
  h: SqliteD1Harness,
  userId: string,
  id: string,
  favicon: string | null = null,
  coverImage: string | null = null,
) {
  const now = new Date().toISOString()
  h.sqlite
    .prepare(
      `INSERT INTO bookmarks (id, user_id, title, url, favicon, cover_image, created_at, updated_at)
       VALUES (?, ?, 't', 'https://example.com/a', ?, ?, ?, ?)`,
    )
    .run(id, userId, favicon, coverImage, now, now)
}
