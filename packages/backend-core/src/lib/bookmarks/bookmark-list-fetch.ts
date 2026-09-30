import type { SQLParam } from '../types'
import { chunkForD1In } from '../d1-chunk'
import { BOOKMARK_STATUS_COLUMNS, getFolderFilterClause, parseBookmarkStatus } from './bookmark-list'

export async function fetchBookmarkTags(
  db: D1Database,
  userId: string,
  bookmarkIds: string[]
): Promise<Map<string, Array<{ id: string; name: string; color: string | null }>>> {
  const tagsByBookmarkId = new Map<string, Array<{ id: string; name: string; color: string | null }>>()
  if (bookmarkIds.length === 0) return tagsByBookmarkId

  // D1 caps bound parameters at 100/query: a full 200-bookmark page (and the
  // public share page's unbounded set) used to 500 on this read. Chunk it.
  for (const chunk of chunkForD1In(bookmarkIds, 1)) {
    const placeholders = chunk.map(() => '?').join(',')
    const { results: tagResults } = await db.prepare(
      `SELECT
         bt.bookmark_id,
         t.id,
         t.name,
         t.color
       FROM tags t
       INNER JOIN bookmark_tags bt ON t.id = bt.tag_id
       WHERE bt.bookmark_id IN (${placeholders})
         AND bt.user_id = ?
         AND t.user_id = bt.user_id
         AND t.deleted_at IS NULL
       ORDER BY bt.bookmark_id, t.name`
    )
      .bind(...chunk, userId)
      .all<{ bookmark_id: string; id: string; name: string; color: string | null }>()

    for (const tag of tagResults || []) {
      if (!tagsByBookmarkId.has(tag.bookmark_id)) {
        tagsByBookmarkId.set(tag.bookmark_id, [])
      }
      tagsByBookmarkId.get(tag.bookmark_id)!.push({
        id: tag.id,
        name: tag.name,
        color: tag.color,
      })
    }
  }
  return tagsByBookmarkId
}

export async function fetchRelatedTagIds(
  db: D1Database,
  userId: string,
  selectedTagIds: string[],
  folderId: string | null,
  status?: string | null
): Promise<string[]> {
  if (selectedTagIds.length === 0) return []

  const selectedPlaceholders = selectedTagIds.map(() => '?').join(',')
  const params: SQLParam[] = [userId, ...selectedTagIds, ...selectedTagIds]
  const folderClause = getFolderFilterClause(folderId, params)
  const statusFilter = parseBookmarkStatus(status ?? null)
  const statusClause = statusFilter ? `AND ${BOOKMARK_STATUS_COLUMNS[statusFilter]} = 1` : ''

  params.push(selectedTagIds.length)

  const { results } = await db.prepare(
    `SELECT bt2.tag_id
     FROM bookmark_tags bt1
     JOIN bookmark_tags bt2
       ON bt1.bookmark_id = bt2.bookmark_id AND bt1.user_id = bt2.user_id
     JOIN bookmarks b
       ON b.id = bt1.bookmark_id AND b.user_id = bt1.user_id
     JOIN tags t
       ON t.id = bt2.tag_id AND t.user_id = bt2.user_id
     WHERE bt1.user_id = ?
       AND bt1.tag_id IN (${selectedPlaceholders})
       AND bt2.tag_id NOT IN (${selectedPlaceholders})
       AND b.deleted_at IS NULL
       AND t.deleted_at IS NULL
       ${folderClause}
       ${statusClause}
     GROUP BY bt2.tag_id
     HAVING COUNT(DISTINCT bt1.tag_id) = ?
     ORDER BY COUNT(DISTINCT bt1.bookmark_id) DESC, LOWER(t.name) ASC
     LIMIT 24`
  )
    .bind(...params)
    .all<{ tag_id: string }>()

  return (results || []).map((row) => row.tag_id)
}
