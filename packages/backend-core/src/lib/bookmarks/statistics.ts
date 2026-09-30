/**
 * Bookmark statistics domain helpers, shared by the bookmark-statistics route.
 */

export interface BookmarkStatistics {
  summary: {
    total_bookmarks: number
    total_tags: number
    total_clicks: number
  }
  top_bookmarks: Array<{
    id: string
    title: string
    url: string
    click_count: number
    last_clicked_at: string | null
  }>
  top_tags: Array<{
    id: string
    name: string
    color: string | null
    click_count: number
    bookmark_count: number
  }>
  top_domains: Array<{ domain: string; count: number }>
  bookmark_clicks: Array<{ id: string; title: string; url: string; click_count: number }>
  recent_clicks: Array<{ id: string; title: string; url: string; last_clicked_at: string }>
  trends: {
    bookmarks: Array<{ date: string; count: number }>
    clicks: Array<{ date: string; count: number }>
  }
}

/**
 * Build the date-grouping SQL fragments for a trend query. `field` is a
 * hardcoded column name (never user input), so interpolating it is safe.
 */
export function getDateGroupSql(granularity: string, field: string) {
  switch (granularity) {
    case 'year':
      return { dateGroupBy: `strftime('%Y', ${field})`, dateSelect: `strftime('%Y', ${field}) as date` }
    case 'month':
      return { dateGroupBy: `strftime('%Y-%m', ${field})`, dateSelect: `strftime('%Y-%m', ${field}) as date` }
    case 'week':
      return {
        dateGroupBy: `strftime('%Y-W%W', ${field})`,
        dateSelect: `strftime('%Y-W%W', ${field}) as date`,
      }
    case 'day':
    default:
      return { dateGroupBy: `DATE(${field})`, dateSelect: `DATE(${field}) as date` }
  }
}
