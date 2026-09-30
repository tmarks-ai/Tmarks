import type { ExportOptions, TMarksExportData } from '@tmarks/contracts'

/**
 * Apply the caller's export options to collected data before serialization:
 * drop tag links and tag entities (include_tags), the metadata block
 * (include_metadata), and click statistics (format_options.include_click_stats).
 * The route streams the filtered result (see export-stream.ts).
 */
export function filterExportData(data: TMarksExportData, options?: ExportOptions): TMarksExportData {
  const filtered = { ...data }

  if (!options?.include_tags) {
    filtered.tags = []
    filtered.bookmarks = filtered.bookmarks.map((bookmark) => ({ ...bookmark, tags: [] }))
  }

  if (!options?.include_metadata) {
    delete filtered.metadata
  }

  if (!options?.format_options?.include_click_stats) {
    filtered.bookmarks = filtered.bookmarks.map((bookmark) => {
      const { click_count: _clickCount, last_clicked_at: _lastClickedAt, ...rest } = bookmark
      return rest
    })
    filtered.tags = filtered.tags.map((tag) => {
      const { click_count: _clickCount, last_clicked_at: _lastClickedAt, ...rest } = tag
      return rest
    })
  }

  return filtered
}