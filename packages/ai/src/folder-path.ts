const PLACEHOLDER_FOLDER_VALUES = new Set([
  'null',
  'none',
  'undefined',
  'n/a',
  'na',
  'nil',
  'primary',
  'secondary',
  'category',
  'category 1',
  'category 2',
  'folder',
])

const FOLDER_PATH_SEPARATOR = /[/>|\\]+/

export function normalizeFolderPart(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const normalized = value.trim().replace(/\s+/g, ' ').slice(0, 120)
  if (!normalized) return undefined
  if (PLACEHOLDER_FOLDER_VALUES.has(normalized.toLowerCase())) return undefined
  return normalized
}

export function normalizeFolderPath(path?: unknown[]): string[] | undefined {
  const seen = new Set<string>()
  const normalized: string[] = []

  for (const item of path || []) {
    const folderPart = normalizeFolderPart(item)
    if (!folderPart) continue

    const key = folderPart.toLowerCase()
    if (seen.has(key)) continue

    seen.add(key)
    normalized.push(folderPart)
    if (normalized.length >= 2) break
  }

  return normalized.length > 0 ? normalized : undefined
}

export function splitFolderPath(folder?: string): string[] | undefined {
  if (!folder) return undefined
  return normalizeFolderPath(folder.split(FOLDER_PATH_SEPARATOR))
}

export function uniqueStrings(values: string[] | undefined): string[] {
  const seen = new Set<string>()
  const result: string[] = []

  for (const value of values || []) {
    const normalized = value.trim()
    const key = normalized.toLowerCase()
    if (!normalized || seen.has(key)) continue
    seen.add(key)
    result.push(normalized.slice(0, 64))
  }

  return result
}
