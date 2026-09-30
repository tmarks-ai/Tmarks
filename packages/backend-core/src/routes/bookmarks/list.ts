import type { Context } from 'hono'
import type { AppEnv } from '../../lib/env'
import {
  BookmarkFilterLimitError,
  buildBookmarkListQueries,
  createBookmarkPageCursor,
  fetchBookmarkTags,
  fetchRelatedTagIds,
  fetchFolderPathMap,
  normalizeBookmark,
  parseTagFilterParam,
  type BookmarkListRow,
  type BookmarkWithTags,
} from '../../lib/bookmarks'
import { badRequest, internalError, success } from '../../lib/response'

/** GET /bookmarks — cursor-paginated list with filters, tags, folder paths. */
export async function listBookmarksHandler(c: Context<AppEnv>): Promise<Response> {
  const auth = c.get('auth')
  const userId = auth?.user_id
  if (!userId) {
    return internalError('User not found')
  }
  const url = new URL(c.req.url)

  try {
    const { arms, pageSize, sortBy } = buildBookmarkListQueries(userId, url)
    // Arms run concurrently (each is index-ordered; see the builder doc).
    // The global order is `pinned segment ++ unpinned segment`, so plain
    // concatenation reproduces the old single-query order.
    const sets = await Promise.all(
      arms.map((arm) => c.env.DB.prepare(arm.query).bind(...arm.params).all<BookmarkListRow>())
    )
    const results = sets.flatMap((set) => set.results || [])
    const selectedTagIds = parseTagFilterParam(url.searchParams.get('tags'))
    const relatedTagIds = await fetchRelatedTagIds(
      c.env.DB,
      userId,
      selectedTagIds,
      url.searchParams.get('folder_id'),
      url.searchParams.get('status')
    )

    const hasMore = results.length > pageSize
    const bookmarks = hasMore ? results.slice(0, pageSize) : results
    const nextCursor =
      hasMore && bookmarks.length > 0
        ? createBookmarkPageCursor(bookmarks[bookmarks.length - 1]!, sortBy)
        : null

    const bookmarkIds = bookmarks.map((b) => b.id)
    const tagsByBookmarkId = await fetchBookmarkTags(c.env.DB, userId, bookmarkIds)

    const bookmarksWithTags: BookmarkWithTags[] = bookmarks.map((row) => {
      const normalized = normalizeBookmark(row)
      return {
        ...normalized,
        tags: tagsByBookmarkId.get(row.id) || [],
      }
    })

    // One IN read for every distinct folder on the page — the previous
    // per-bookmark await was ~100 sequential round trips on a default page.
    const folderPathMap = await fetchFolderPathMap(c.env.DB, userId, bookmarksWithTags.map((b) => b.folder_id))
    const bookmarksWithFolderPath = bookmarksWithTags.map((bookmark) => ({
      ...bookmark,
      folder_path: (bookmark.folder_id && folderPathMap.get(bookmark.folder_id)) || [],
    }))

    return success({
      bookmarks: bookmarksWithFolderPath,
      meta: {
        page_size: pageSize,
        count: bookmarks.length,
        next_cursor: nextCursor,
        has_more: hasMore,
        related_tag_ids: relatedTagIds,
      },
    })
  } catch (error) {
    if (error instanceof BookmarkFilterLimitError) {
      return badRequest(error.message)
    }
    console.error('Get bookmarks error:', error)
    return internalError('Failed to get bookmarks')
  }
}
