import type { Context } from 'hono'
import type { AppEnv } from '../../lib/env'
import { badRequest, internalError, success } from '../../lib/response'
import { normalizeBookmarkUrl } from '../../lib/bookmarks'

/**
 * `GET /api/v1/bookmarks/check-url?url=...` — 查重:当前用户是否已存在该 URL
 * 的书签(忽略 hash、协议/主机大小写、尾部斜杠)。返回 `{ exists, bookmark_id }`。
 */
export async function checkUrlHandler(c: Context<AppEnv>): Promise<Response> {
  const auth = c.get('auth')
  if (!auth) return internalError('User not found')
  try {
    const rawUrl = new URL(c.req.url).searchParams.get('url')
    if (!rawUrl) return badRequest('`url` query parameter is required')

    const normalized = normalizeBookmarkUrl(rawUrl)
    const indexed = await c.env.DB
      .prepare(
        `SELECT id, url, normalized_url, title FROM bookmarks
         WHERE user_id = ? AND deleted_at IS NULL AND normalized_url = ?
         LIMIT 1`
      )
      .bind(auth.user_id, normalized)
      .first<{ id: string; url: string; normalized_url: string | null; title: string | null }>()
    const row = indexed && normalizeBookmarkUrl(indexed.url) === normalized
      ? indexed
      // 回退只扫"没有 normalized_url 的历史行"(索引查询覆盖不了的那部分):
      // 每条写入路径现在都会写 normalized_url,这个集合只缩不涨,不再按
      // "最近 500 条"近似——老库中第 501 条之后的历史行此前会误报不存在。
      : (await c.env.DB
        .prepare(
          `SELECT id, url, normalized_url, title FROM bookmarks
           WHERE user_id = ? AND deleted_at IS NULL
             AND (normalized_url IS NULL OR normalized_url = '')`
        )
        .bind(auth.user_id)
        .all<{ id: string; url: string; normalized_url: string | null; title: string | null }>()
      ).results.find((bookmark) => normalizeBookmarkUrl(bookmark.url) === normalized)

    return success({
      exists: Boolean(row),
      bookmark_id: row?.id ?? null,
      title: row?.title ?? null,
    })
  } catch (error) {
    console.error('Check URL error:', error)
    return internalError('Failed to check URL.')
  }
}
