import { chunkForD1In } from '../d1-chunk'

/**
 * Bulk getBookmarkFolderPath: one IN read per chunk for the page's distinct
 * folder ids instead of one round trip per bookmark row (100-row page = 100
 * queries). Same two-level shape as the singular helper.
 *
 * Chunked against D1's 100-bound-parameter cap: a full 200-bookmark page can
 * carry more than 99 distinct folders (R5-1).
 */
export async function fetchFolderPathMap(
  db: D1Database,
  userId: string,
  folderIds: Array<string | null | undefined>
): Promise<Map<string, string[]>> {
  const ids = [...new Set(folderIds.filter((id): id is string => Boolean(id)))]
  const map = new Map<string, string[]>()
  if (ids.length === 0) return map

  for (const chunk of chunkForD1In(ids, 1)) {
    const placeholders = chunk.map(() => '?').join(',')
    const { results } = await db.prepare(
      `SELECT child.id as child_id, child.name as child_name, parent.name as parent_name
       FROM bookmark_folders child
       LEFT JOIN bookmark_folders parent ON parent.id = child.parent_id
       WHERE child.id IN (${placeholders}) AND child.user_id = ? AND child.is_deleted = 0`
    )
      .bind(...chunk, userId)
      .all<{ child_id: string; child_name: string; parent_name: string | null }>()

    for (const row of results || []) {
      map.set(row.child_id, [row.parent_name, row.child_name].filter((value): value is string => Boolean(value)))
    }
  }
  return map
}
