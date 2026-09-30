import type { BookmarkRow } from '../types'
import { chunkForD1In } from '../d1-chunk'
import { normalizeBookmark } from './bookmark-utils'
import type { TrashBookmarksData } from './trash-types'

/**
 * Trash cursors pack `deleted_at` with the row id. Bulk deletes stamp every row
 * with the same timestamp, so a timestamp-only cursor silently skipped whole
 * pages of ties. Legacy cursors (bare timestamps) still parse.
 */
function parseTrashCursor(raw: string | undefined): { deletedAt: string; id: string | null } | null {
  if (!raw) return null
  const separator = raw.lastIndexOf('|')
  if (separator === -1) return { deletedAt: raw, id: null }
  return { deletedAt: raw.slice(0, separator), id: raw.slice(separator + 1) }
}

function createTrashCursor(row: BookmarkRow): string {
  return `${row.deleted_at}|${row.id}`
}

/** Cursor-paginated listing of trashed bookmarks, newest-deleted first by default. */
export async function getTrashBookmarks(
  db: D1Database,
  userId: string,
  params: {
    page_size?: string
    page_cursor?: string
    sort?: string
  }
): Promise<{ success: boolean; data?: TrashBookmarksData; error?: string }> {
  try {
    const pageSize = Math.min(Math.max(parseInt(params.page_size || '20', 10) || 20, 1), 100)
    const sort = params.sort === 'deleted_at_asc' ? 'ASC' : 'DESC'

    let query = `
      SELECT * FROM bookmarks
      WHERE user_id = ? AND deleted_at IS NOT NULL
    `
    const queryParams: Array<string | number> = [userId]

    const cursor = parseTrashCursor(params.page_cursor)
    if (cursor) {
      const comparison = sort === 'ASC' ? '>' : '<'
      if (cursor.id) {
        query += ` AND (deleted_at ${comparison} ? OR (deleted_at = ? AND id ${comparison} ?))`
        queryParams.push(cursor.deletedAt, cursor.deletedAt, cursor.id)
      } else {
        query += ` AND deleted_at ${comparison} ?`
        queryParams.push(cursor.deletedAt)
      }
    }

    query += ` ORDER BY deleted_at ${sort}, id ${sort} LIMIT ?`
    queryParams.push(pageSize + 1)

    const { results: bookmarks } = await db.prepare(query).bind(...queryParams).all<BookmarkRow>()

    const hasMore = bookmarks.length > pageSize
    const items = hasMore ? bookmarks.slice(0, pageSize) : bookmarks

    // 单次 IN 批量取回整页标签,替代逐书签 N+1 查询。页面上限 100 条时恰好
    // 触到 D1 每查询 100 绑定参数的上限,分片留余量。
    const itemIds = items.map((bookmark) => bookmark.id)
    const tagsByBookmark = new Map<string, Array<{ id: string; name: string; color: string | null }>>()
    for (const chunk of chunkForD1In(itemIds, 0)) {
      const placeholders = chunk.map(() => '?').join(',')
      const { results: tagRows } = await db
        .prepare(
          `SELECT bt.bookmark_id, t.id, t.name, t.color
           FROM bookmark_tags bt
           INNER JOIN tags t ON t.id = bt.tag_id
           WHERE bt.bookmark_id IN (${placeholders}) AND t.deleted_at IS NULL`
        )
        .bind(...chunk)
        .all<{ bookmark_id: string; id: string; name: string; color: string | null }>()
      for (const row of tagRows || []) {
        const list = tagsByBookmark.get(row.bookmark_id) ?? []
        list.push(row)
        tagsByBookmark.set(row.bookmark_id, list)
      }
    }

    const bookmarksWithTags = items.map((bookmark) => ({
      ...normalizeBookmark(bookmark),
      tags: tagsByBookmark.get(bookmark.id) || [],
    }))

    const countResult = await db
      .prepare('SELECT COUNT(*) as count FROM bookmarks WHERE user_id = ? AND deleted_at IS NOT NULL')
      .bind(userId)
      .first<{ count: number }>()

    return {
      success: true,
      data: {
        bookmarks: bookmarksWithTags,
        meta: {
          total: countResult?.count || 0,
          page_size: pageSize,
          has_more: hasMore,
          next_cursor: hasMore && items.length > 0 ? createTrashCursor(items[items.length - 1]) : null,
        },
      },
    }
  } catch (error) {
    console.error('Get trash bookmarks error:', error)
    return { success: false, error: 'Failed to get trash bookmarks' }
  }
}
