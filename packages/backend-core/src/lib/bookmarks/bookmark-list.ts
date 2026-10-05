import type { BookmarkRow, SQLParam } from '../types'
import type { BookmarkStatusFilter } from '@tmarks/contracts'
import { escapeLike } from '../utils'
import { D1_MAX_BIND_PARAMS } from '../d1-chunk'
import {
  looksLikeJsonCursor,
  normalizeBookmarkSort,
  parseBookmarkPageCursor,
  getBookmarkSortField,
  type BookmarkPageCursor,
  type BookmarkSort,
} from './bookmark-cursor'

export type BookmarkListRow = BookmarkRow
export type { BookmarkSort, BookmarkPageCursor }
export {
  createBookmarkPageCursor,
  parseBookmarkPageCursor,
  normalizeBookmarkSort,
  getBookmarkSortField,
} from './bookmark-cursor'

/** 状态筛选 → SQL 列映射。新增状态只需在此加一行,列表/相关标签自动生效。 */
export const BOOKMARK_STATUS_COLUMNS: Record<Exclude<BookmarkStatusFilter, 'all'>, string> = {
  todo: 'b.is_todo',
  pinned: 'b.is_pinned',
  archived: 'b.is_archived',
  private: 'b.is_private',
}

/** 解析 `status` 查询参数:非法/缺省返回 undefined(不加子句)。 */
export function parseBookmarkStatus(raw: string | null): Exclude<BookmarkStatusFilter, 'all'> | undefined {
  if (!raw) return undefined
  return raw in BOOKMARK_STATUS_COLUMNS ? (raw as Exclude<BookmarkStatusFilter, 'all'>) : undefined
}

/**
 * Filter parameters whose IN(...) expansion cannot be chunked (the tag arm's
 * `HAVING COUNT(DISTINCT tag_id) = N` subquery needs all N ids in one
 * statement), so they carry an explicit count cap that keeps every emitted
 * query inside D1's 100-bound-parameter budget. The route maps this to 400.
 */
export class BookmarkFilterLimitError extends Error {}

// The related-tags arm binds each selected tag twice (IN + NOT IN) plus user,
// folder and count params: 2*40 + 3 = 83 ≤ 100.
const MAX_TAG_FILTER_IDS = 40
// Absolute ceiling for the folder IN(...) expansion when the caller passes no
// tighter budget; bookmark-list.ts passes one computed from the arm's other
// params (R8 BL-2: folder+tags+keyword+cursor must SUM ≤ 100 or real D1 500s
// while local SQLite — cap 999 — stays green).
const MAX_FOLDER_FILTER_IDS = 99

/** Split and cap the `tags` filter param; throws BookmarkFilterLimitError when over. */
export function parseTagFilterParam(raw: string | null): string[] {
  const tagIds = (raw || '').split(',').map((id) => id.trim()).filter(Boolean)
  if (tagIds.length > MAX_TAG_FILTER_IDS) {
    throw new BookmarkFilterLimitError(`Too many tags in filter (max ${MAX_TAG_FILTER_IDS})`)
  }
  return tagIds
}

export function getFolderFilterClause(
  folderId: string | null,
  params: SQLParam[],
  column = 'b.folder_id',
  maxFolderIds: number = MAX_FOLDER_FILTER_IDS
): string {
  if (folderId === 'none') {
    return `AND ${column} IS NULL`
  }

  const folderIds = folderId?.split(',').map((id) => id.trim()).filter(Boolean) ?? []
  if (folderIds.length === 0) return ''
  if (folderIds.length > maxFolderIds) {
    throw new BookmarkFilterLimitError(
      `Too many folders in filter (max ${maxFolderIds} with the current keyword/tags/cursor combination)`,
    )
  }

  params.push(...folderIds)
  return `AND ${column} IN (${folderIds.map(() => '?').join(',')})`
}

export interface BookmarkListArm {
  query: string
  params: SQLParam[]
}

export interface BookmarkListQueries {
  arms: BookmarkListArm[]
  pageSize: number
  sortBy: BookmarkSort
}

/**
 * Two-arm bookmark list query (D1 bills scanned rows: the old single query's
 * `ORDER BY is_pinned DESC, CASE…pin_order…, sort DESC` matched no index, so
 * every page scanned all live rows and sorted them).
 *
 *  - pinned arm:   is_pinned = 1, ORDER BY pin_order, sort, id
 *                  (idx_bookmarks_user_pinned_order)
 *  - unpinned arm: is_pinned = 0, ORDER BY sort, id
 *                  (idx_bookmarks_pinned / _user_pinned_updated /
 *                   _user_pinned_clicks by sort — migration 0003)
 *
 * The global order is exactly `pinned segment ++ unpinned segment`, so the
 * handler concatenates the arms and truncates. Arms already exhausted by the
 * cursor are omitted (a cursor on an unpinned row skips the whole pinned
 * arm). `manual` sort and single-pin filters degenerate to one arm with the
 * legacy SQL shape.
 */
export function buildBookmarkListQueries(userId: string, url: URL): BookmarkListQueries {
  const keyword = url.searchParams.get('keyword')
  const tags = url.searchParams.get('tags')
  const folderId = url.searchParams.get('folder_id')
  const pageSize = Math.max(1, Math.min(parseInt(url.searchParams.get('page_size') || '100') || 100, 200))
  const pageCursor = url.searchParams.get('page_cursor')
  const parsedCursor = parseBookmarkPageCursor(pageCursor)
  const sortBy = normalizeBookmarkSort(url.searchParams.get('sort'))
  const pinnedParam = url.searchParams.get('pinned')
  const pinned = pinnedParam ? pinnedParam === 'true' : undefined
  const status = parseBookmarkStatus(url.searchParams.get('status'))
  const pinnedOnly = pinned === true || status === 'pinned'
  const sortField = getBookmarkSortField(sortBy)
  const isManual = sortBy === 'manual'

  const legacyRawCursor = pageCursor && !parsedCursor && !looksLikeJsonCursor(pageCursor)

  // Arm selection + per-arm cursor predicates (non-manual). A cursor sitting
  // on a pinned row continues the pinned arm AND restarts the unpinned arm;
  // a cursor on an unpinned row skips the pinned arm entirely.
  let runPinnedArm = false
  let runUnpinnedArm = false
  if (!isManual) {
    if (pinnedOnly) {
      runPinnedArm = true
    } else if (pinned === false) {
      runUnpinnedArm = true
    } else if (pinned === true) {
      runPinnedArm = true
    } else {
      runPinnedArm = !(parsedCursor && !parsedCursor.isPinned)
      runUnpinnedArm = true
    }
  }

  const arms: BookmarkListArm[] = []

  // R8 BL-2: D1 每查询 100 绑定参数,folder IN(...) 不可分片——按"即将运行的
  // 臂"算最坏固定开销,folder 数装进剩余预算,超限抛错由路由映射 400。
  const tagIds = parseTagFilterParam(tags)
  const tagParamCount = tagIds.length > 0 ? tagIds.length + 2 : 0
  const keywordParamCount = keyword ? 3 : 0
  const pinnedArmCursorParams = parsedCursor ? (parsedCursor.isPinned ? 5 : 0) : (legacyRawCursor ? 1 : 0)
  const unpinnedArmCursorParams = parsedCursor ? (parsedCursor.isPinned ? 0 : 3) : (legacyRawCursor ? 1 : 0)
  const manualArmCursorParams = parsedCursor ? 3 : (legacyRawCursor ? 1 : 0)
  let fixedOverhead = 0
  if (isManual) {
    fixedOverhead = 1 + (pinned !== undefined ? 1 : 0) + keywordParamCount + tagParamCount + manualArmCursorParams + 1
  } else {
    if (runPinnedArm) {
      fixedOverhead = Math.max(fixedOverhead, 2 + keywordParamCount + tagParamCount + pinnedArmCursorParams + 1)
    }
    if (runUnpinnedArm) {
      fixedOverhead = Math.max(fixedOverhead, 2 + keywordParamCount + tagParamCount + unpinnedArmCursorParams + 1)
    }
  }
  const folderFilterCap = D1_MAX_BIND_PARAMS - fixedOverhead

  // keyword/folder/tag 子句为两臂与 manual 臂共用。
  const appendFilters = (query: string, params: SQLParam[]): string => {
    let q = query
    if (keyword) {
      q += ` AND (b.title LIKE ? ESCAPE '\\' OR b.description LIKE ? ESCAPE '\\' OR b.url LIKE ? ESCAPE '\\')`
      const searchPattern = `%${escapeLike(keyword)}%`
      params.push(searchPattern, searchPattern, searchPattern)
    }
    const folderClause = getFolderFilterClause(folderId, params, 'b.folder_id', folderFilterCap)
    if (folderClause) q += ` ${folderClause}`
    if (tagIds.length > 0) {
      const tagPlaceholders = tagIds.map(() => '?').join(',')
      q += ` AND b.id IN (
        SELECT bt.bookmark_id
        FROM bookmark_tags bt
        WHERE bt.user_id = ? AND bt.tag_id IN (${tagPlaceholders})
        GROUP BY bt.bookmark_id
        HAVING COUNT(DISTINCT bt.tag_id) = ?
      )`
      params.push(userId, ...tagIds, tagIds.length)
    }
    return q
  }

  const buildArm = (armPinned: boolean, armOrderBy: string, cursorPredicate: string, cursorParams: SQLParam[]): BookmarkListArm => {
    let query = `
    SELECT b.*
    FROM bookmarks b
    WHERE b.user_id = ? AND b.deleted_at IS NULL
      AND b.is_pinned = ?`
    const params: SQLParam[] = [userId, armPinned ? 1 : 0]

    if (status && status !== 'pinned') {
      query += ` AND ${BOOKMARK_STATUS_COLUMNS[status]} = 1`
    }

    query = appendFilters(query, params)

    if (cursorPredicate) {
      query += ` AND ${cursorPredicate}`
      params.push(...cursorParams)
    } else if (legacyRawCursor) {
      // Legacy clients sent the raw bookmark id as the cursor. A malformed
      // JSON-shaped cursor is instead treated as "no cursor" → first page.
      query += ` AND b.id < ?`
      params.push(pageCursor as string)
    }

    query += ` ORDER BY ${armOrderBy} LIMIT ?`
    params.push(pageSize + 1)
    return { query, params }
  }

  if (isManual) {
    // Manual order never pinned-first: single arm, legacy shape.
    let query = `
    SELECT b.*
    FROM bookmarks b
    WHERE b.user_id = ? AND b.deleted_at IS NULL`
    const params: SQLParam[] = [userId]
    if (pinned !== undefined) {
      query += ` AND b.is_pinned = ?`
      params.push(pinned ? 1 : 0)
    }
    if (status) {
      // manual 排序无 pinned 前缀,status=pinned 就是普通行过滤(与旧查询一致)。

      query += ` AND ${BOOKMARK_STATUS_COLUMNS[status]} = 1`
    }
    query = appendFilters(query, params)

    if (parsedCursor) {
      const pos = Number(parsedCursor.sortValue ?? 0)
      query += ` AND (b.position > ? OR (b.position = ? AND b.id > ?))`
      params.push(pos, pos, parsedCursor.id)
    } else if (legacyRawCursor) {
      query += ` AND b.id < ?`
      params.push(pageCursor as string)
    }
    query += ` ORDER BY b.position ASC, b.id ASC LIMIT ?`
    params.push(pageSize + 1)
    arms.push({ query, params })
    return { arms, pageSize, sortBy }
  }

  if (runPinnedArm) {
    // pin_order is NOT NULL DEFAULT 0 in the baseline — the bare column keeps
    // idx_bookmarks_user_pinned_order fully ordered (a COALESCE here would
    // force a temp-b-tree sort over the segment, EXPLAIN-verified).
    const continuePinned = parsedCursor && parsedCursor.isPinned
    const pinOrder = continuePinned ? parsedCursor!.pinOrder ?? 0 : 0
    arms.push(
      buildArm(
        true,
        `b.pin_order ASC, ${sortField} DESC, b.id DESC`,
        continuePinned
          ? `(b.pin_order > ? OR (b.pin_order = ? AND (${sortField} < ? OR (${sortField} = ? AND b.id < ?))))`
          : '',
        continuePinned
          ? [pinOrder, pinOrder, parsedCursor!.sortValue, parsedCursor!.sortValue, parsedCursor!.id]
          : []
      )
    )
  }

  if (runUnpinnedArm) {
    const continueUnpinned = parsedCursor && !parsedCursor.isPinned
    arms.push(
      buildArm(
        false,
        `${sortField} DESC, b.id DESC`,
        continueUnpinned ? `(${sortField} < ? OR (${sortField} = ? AND b.id < ?))` : '',
        continueUnpinned ? [parsedCursor!.sortValue, parsedCursor!.sortValue, parsedCursor!.id] : []
      )
    )
  }

  // Contradictory filters (pinned=false + status=pinned) must stay empty like
  // the old query — both predicates were ANDed there.
  if (pinnedOnly && pinned === false) {
    arms.length = 0
    arms.push({
      query: 'SELECT b.* FROM bookmarks b WHERE b.user_id = ? AND b.deleted_at IS NULL AND b.is_pinned = ? AND b.is_pinned = 1 LIMIT ?',
      params: [userId, 0, pageSize + 1],
    })
  }

  return { arms, pageSize, sortBy }
}
