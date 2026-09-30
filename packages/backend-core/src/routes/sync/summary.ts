import type { Context } from 'hono'
import { internalError, success } from '../../lib/response'
import type { AppEnv } from '../../lib/env'
import { decodeCursor } from '../../lib/sync'

interface EntitySummaryRow {
  count: number
  max_updated_at: string | null
}

interface MaxIdRow {
  id: number
}

interface PendingRow {
  pending: number
}

const entityQueries = [
  // bookmarks: soft delete via deleted_at
  `SELECT COUNT(*) AS count, MAX(updated_at) AS max_updated_at
   FROM bookmarks WHERE user_id = ? AND deleted_at IS NULL`,
  // bookmark_folders: soft delete via is_deleted flag
  `SELECT COUNT(*) AS count, MAX(updated_at) AS max_updated_at
   FROM bookmark_folders WHERE user_id = ? AND is_deleted = 0`,
  // tags: soft delete via deleted_at
  `SELECT COUNT(*) AS count, MAX(updated_at) AS max_updated_at
   FROM tags WHERE user_id = ? AND deleted_at IS NULL`,
  // tab_groups: soft delete via is_deleted flag
  `SELECT COUNT(*) AS count, MAX(updated_at) AS max_updated_at
   FROM tab_groups WHERE user_id = ? AND is_deleted = 0`,
  // tab_group_items: hard DELETE, no updated_at column; inherit from parent group
  `SELECT COUNT(*) AS count, MAX(COALESCE(tg.updated_at, tgi.created_at)) AS max_updated_at
   FROM tab_group_items tgi
   JOIN tab_groups tg ON tg.id = tgi.group_id
   WHERE tg.user_id = ? AND tg.is_deleted = 0`,
] as const

/**
 * GET /api/v1/sync/summary
 *
 * Aggregated per-entity state for the sync-check page. Each entity query
 * returns the number of "live" rows (soft deletes excluded) plus the latest
 * update timestamp the client can use as an upper bound for change detection.
 * All five entity queries plus cursor bookkeeping go through a single
 * db.batch so the endpoint costs exactly one round trip.
 *
 * Accepts optional `?cursor=` (encoded) or `?after_id=` (raw row id). When
 * provided, pendingOperations reports how many sync_changes rows exist past
 * that marker; when omitted it reports 0 and cursorBound still tells the
 * client where "everything" ends.
 */
export async function syncSummaryHandler(c: Context<AppEnv>): Promise<Response> {
  const auth = c.get('auth')
  if (!auth) return internalError('User not found')

  const db = c.env.DB
  const userId = auth.user_id

  const url = new URL(c.req.url)
  const encodedCursor = url.searchParams.get('cursor')
  const rawAfterId = url.searchParams.get('after_id')
  // Caller may send either an encoded cursor or a raw sync_changes row id.
  // When neither is provided we cannot compute a backlog, so we bind null
  // and let MAX(id) > NULL evaluate to no rows (pendingOperations = 0).
  const afterId = rawAfterId !== null
    ? Math.max(0, Number.parseInt(rawAfterId, 10) || 0)
    : encodedCursor !== null
      ? decodeCursor(encodedCursor)
      : null

  try {
    const statements = entityQueries.map((sql) => db.prepare(sql).bind(userId))
    // cursorBound: max sync_changes.id; client uses this as its afterId to
    // catch up to "current".
    statements.push(
      db
        .prepare('SELECT COALESCE(MAX(id), 0) AS id FROM sync_changes WHERE user_id = ?')
        .bind(userId),
    )
    // pendingOperations: rows past the caller's last-seen marker. With no
    // cursor we bind NULL so SQLite yields 0 instead of guessing.
    statements.push(
      db
        .prepare('SELECT COUNT(id) AS pending FROM sync_changes WHERE user_id = ? AND id > ?')
        .bind(userId, afterId),
    )

    const [bookmarkResult, folderResult, tagResult, tabGroupResult, tabGroupItemResult, cursorResult, pendingResult] =
      await db.batch(statements)

    const firstRow = <T,>(result: { results?: unknown[] } | undefined): T | undefined =>
      (result?.results?.[0] ?? undefined) as T | undefined
    const toSummary = (row: EntitySummaryRow | undefined) => ({
      count: Number(row?.count ?? 0),
      maxUpdatedAt: row?.max_updated_at ?? null,
    })

    const cursorRow = firstRow<MaxIdRow>(cursorResult)
    const pendingRow = firstRow<PendingRow>(pendingResult)
    const cursorBound = Number(cursorRow?.id ?? 0)

    return success({
      entities: {
        bookmarks: toSummary(firstRow<EntitySummaryRow>(bookmarkResult)),
        bookmark_folders: toSummary(firstRow<EntitySummaryRow>(folderResult)),
        tags: toSummary(firstRow<EntitySummaryRow>(tagResult)),
        tab_groups: toSummary(firstRow<EntitySummaryRow>(tabGroupResult)),
        tab_group_items: toSummary(firstRow<EntitySummaryRow>(tabGroupItemResult)),
      },
      pendingOperations: Number(pendingRow?.pending ?? 0),
      serverTime: new Date().toISOString(),
      cursorBound,
    })
  } catch (error) {
    console.error('Extension sync summary error:', error)
    return internalError('Failed to load sync summary')
  }
}
