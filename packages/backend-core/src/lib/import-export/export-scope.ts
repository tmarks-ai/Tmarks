import type { ExportScope } from '@tmarks/contracts'

export function parseExportScope(raw: string | null | undefined): ExportScope {
  if (raw === 'bookmarks' || raw === 'tab_groups' || raw === 'all') return raw
  return 'all'
}

export function getExportFilename(exportedAtIso: string, scope: ExportScope): string {
  // Date and time both derive from toISOString so the filename is always UTC,
  // independent of the machine timezone the worker runs in.
  const date = new Date(exportedAtIso)
  const iso = date.toISOString()
  const dateStr = iso.split('T')[0]
  const timeStr = iso.slice(11, 19).replace(/:/g, '-')
  const prefix =
    scope === 'bookmarks'
      ? 'tmarks-bookmarks-export'
      : scope === 'tab_groups'
        ? 'tmarks-tab-groups-export'
        : 'tmarks-export'
  return `${prefix}-${dateStr}-${timeStr}.json`
}
