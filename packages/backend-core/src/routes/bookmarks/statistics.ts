import type { Context } from 'hono'
import type { AppEnv } from '../../lib/env'
import { internalError, success } from '../../lib/response'
import { getDateGroupSql, type BookmarkStatistics } from '../../lib/bookmarks'

interface SummaryRow {
  total_bookmarks: number
  active_bookmarks: number
  total_clicks: number
}
interface TagCountRow {
  total_tags: number
}
interface TopBookmarkRow {
  id: string
  title: string
  url: string
  click_count: number
  last_clicked_at: string | null
}
interface TopTagRow {
  id: string
  name: string
  color: string | null
  click_count: number
  bookmark_count: number
}
interface DomainRow {
  domain: string
  count: number
}
interface RecentClickRow {
  id: string
  title: string
  url: string
  last_clicked_at: string
}
interface TrendRow {
  date: string
  count: number
}
interface BookmarkClickRow {
  id: string
  title: string
  url: string
  click_count: number
}

/** GET /bookmarks/statistics — aggregate bookmark stats + trends for the caller. */
export async function bookmarkStatisticsHandler(c: Context<AppEnv>): Promise<Response> {
  const auth = c.get('auth')
  if (!auth) return internalError('User not found')
  const userId = auth.user_id
  const url = new URL(c.req.url)
  const granularity = url.searchParams.get('granularity') || 'day'
  const startDate = url.searchParams.get('start_date')
  const endDate = url.searchParams.get('end_date')
  const dateBounds = [startDate, endDate].filter(Boolean) as string[]

  try {
    const db = c.env.DB
    const { dateGroupBy, dateSelect } = getDateGroupSql(granularity, 'created_at')
    const { dateGroupBy: clickDateGroupBy, dateSelect: clickDateSelect } = getDateGroupSql(
      granularity,
      'clicked_at'
    )

    const [
      summary,
      tagCount,
      topBookmarks,
      topTags,
      topDomains,
      recentClicks,
      bookmarkTrends,
      clickTrends,
      bookmarkClickStats,
    ] = await Promise.all([
      db
        .prepare(
          `SELECT
            COUNT(*) as total_bookmarks,
            SUM(CASE WHEN deleted_at IS NULL THEN 1 ELSE 0 END) as active_bookmarks,
            SUM(click_count) as total_clicks
          FROM bookmarks WHERE user_id = ? AND deleted_at IS NULL`
        )
        .bind(userId)
        .first<SummaryRow>(),
      db
        .prepare('SELECT COUNT(*) as total_tags FROM tags WHERE user_id = ? AND deleted_at IS NULL')
        .bind(userId)
        .first<TagCountRow>(),
      db
        .prepare(
          `SELECT id, title, url, click_count, last_clicked_at FROM bookmarks
           WHERE user_id = ? AND deleted_at IS NULL AND click_count > 0
           ORDER BY click_count DESC, last_clicked_at DESC LIMIT 10`
        )
        .bind(userId)
        .all<TopBookmarkRow>(),
      db
        .prepare(
          `SELECT t.id, t.name, t.color, t.click_count, t.bookmark_count
           FROM tags t
           WHERE t.user_id = ? AND t.deleted_at IS NULL
           ORDER BY t.click_count DESC, t.bookmark_count DESC, t.name ASC LIMIT 10`
        )
        .bind(userId)
        .all<TopTagRow>(),
      db
        .prepare(
          // 域名只取到 host 结束:query/hash 归一成 '/' 后统一在首个 '/' 截断,
          // 否则 https://example.com?a=1 这类无路径 URL 会把 query 记进 domain。
          `WITH rest AS (
            SELECT CASE
              WHEN url LIKE 'http://%' THEN replace(replace(substr(url, 8), '?', '/'), '#', '/')
              WHEN url LIKE 'https://%' THEN replace(replace(substr(url, 9), '?', '/'), '#', '/')
              ELSE url
            END AS r
            FROM bookmarks WHERE user_id = ? AND deleted_at IS NULL
          )
          SELECT
            CASE WHEN instr(r, '/') > 0 THEN substr(r, 1, instr(r, '/') - 1) ELSE r END as domain,
            COUNT(*) as count
          FROM rest GROUP BY domain ORDER BY count DESC LIMIT 10`
        )
        .bind(userId)
        .all<DomainRow>(),
      db
        .prepare(
          `SELECT id, title, url, last_clicked_at FROM bookmarks
           WHERE user_id = ? AND deleted_at IS NULL AND last_clicked_at IS NOT NULL
           ORDER BY last_clicked_at DESC LIMIT 10`
        )
        .bind(userId)
        .all<RecentClickRow>(),
      db
        .prepare(
          `SELECT ${dateSelect}, COUNT(*) as count FROM bookmarks
           WHERE user_id = ? AND deleted_at IS NULL
           ${startDate ? `AND DATE(created_at) >= ?` : ''}
           ${endDate ? `AND DATE(created_at) <= ?` : ''}
           GROUP BY ${dateGroupBy} ORDER BY date ASC`
        )
        .bind(userId, ...dateBounds)
        .all<TrendRow>(),
      db
        .prepare(
          `SELECT ${clickDateSelect}, COUNT(*) as count FROM bookmark_click_events
           WHERE user_id = ?
           ${startDate ? `AND DATE(clicked_at) >= ?` : ''}
           ${endDate ? `AND DATE(clicked_at) <= ?` : ''}
           GROUP BY ${clickDateGroupBy} ORDER BY date ASC`
        )
        .bind(userId, ...dateBounds)
        .all<TrendRow>(),
      db
        .prepare(
          `SELECT b.id, b.title, b.url, COUNT(e.id) as click_count
           FROM bookmark_click_events e JOIN bookmarks b ON e.bookmark_id = b.id
           WHERE e.user_id = ? AND b.deleted_at IS NULL
           ${startDate ? `AND DATE(e.clicked_at) >= ?` : ''}
           ${endDate ? `AND DATE(e.clicked_at) <= ?` : ''}
           GROUP BY b.id, b.title, b.url ORDER BY click_count DESC`
        )
        .bind(userId, ...dateBounds)
        .all<BookmarkClickRow>(),
    ])

    const statistics: BookmarkStatistics = {
      summary: {
        total_bookmarks: summary?.total_bookmarks || 0,
        total_tags: tagCount?.total_tags || 0,
        total_clicks: summary?.total_clicks || 0,
      },
      top_bookmarks: topBookmarks.results || [],
      top_tags: topTags.results || [],
      top_domains: topDomains.results || [],
      recent_clicks: recentClicks.results || [],
      bookmark_clicks: bookmarkClickStats.results || [],
      trends: {
        bookmarks: bookmarkTrends.results || [],
        clicks: clickTrends.results || [],
      },
    }

    return success(statistics)
  } catch (error) {
    console.error('Get bookmark statistics error:', error)
    return internalError('Failed to get statistics')
  }
}
