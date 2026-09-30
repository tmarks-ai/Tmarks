import { normalizeUrlKey } from '@tmarks/ai'

type ImportSource = 'html' | 'json' | 'text'
export type DuplicatePolicy = 'skip' | 'merge'

export interface ImportBookmarkDraft {
  title: string
  url: string
  description: string | null
  folderPath: string[]
  tags: string[]
  sourceIndex: number
  source: ImportSource
}

export interface ImportParseError {
  sourceIndex: number
  message: string
  value?: string
}

export interface ImportParseResult {
  source: ImportSource
  items: ImportBookmarkDraft[]
  errors: ImportParseError[]
}

interface ImportDedupResult {
  items: ImportBookmarkDraft[]
  skipped: number
}

export function normalizeImportBookmark(
  input: Partial<ImportBookmarkDraft> & { url?: unknown; title?: unknown },
  sourceIndex: number,
  source: ImportSource,
): ImportBookmarkDraft | null {
  const rawUrl = typeof input.url === 'string' ? input.url.trim() : ''
  if (!isImportableUrl(rawUrl)) return null
  const url = rawUrl
  const title = typeof input.title === 'string' && input.title.trim() ? input.title.trim() : url
  const folderPath = normalizePath(input.folderPath)
  const tags = normalizeTags(input.tags)
  return {
    title: title.slice(0, 500),
    url,
    description: typeof input.description === 'string' && input.description.trim() ? input.description.trim().slice(0, 1000) : null,
    folderPath,
    tags,
    sourceIndex,
    source,
  }
}

function isImportableUrl(value: string): boolean {
  try {
    const parsed = new URL(value)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}

function normalizeImportKey(url: string): string {
  return normalizeUrlKey(url)
}

function normalizePath(path: unknown): string[] {
  if (!Array.isArray(path)) return []
  return path
    .filter((part): part is string => typeof part === 'string')
    .map((part) => part.trim())
    .filter(Boolean)
    .slice(0, 8)
}

export function normalizeTags(tags: unknown): string[] {
  const values = Array.isArray(tags)
    ? tags
    : typeof tags === 'string'
      ? tags.split(/[,;]+/)
      : []
  return [...new Set(values
    .filter((tag): tag is string => typeof tag === 'string')
    .map((tag) => tag.trim())
    .filter(Boolean)
    .slice(0, 32))]
}

export function dedupeImportBookmarks(
  items: ImportBookmarkDraft[],
  existingUrls: Iterable<string> = [],
  policy: DuplicatePolicy = 'skip',
): ImportDedupResult {
  const seen = new Set([...existingUrls].map(normalizeImportKey))
  const output: ImportBookmarkDraft[] = []
  // Keyed lookup rather than a linear scan of `output`: the scan re-normalized
  // (and re-parsed the URL of) every accepted item for every incoming one, so a
  // 20k-bookmark browser export froze the page on ~2e8 URL parses.
  const acceptedByKey = new Map<string, ImportBookmarkDraft>()
  let skipped = 0

  for (const item of items) {
    const key = normalizeImportKey(item.url)
    const previous = acceptedByKey.get(key)
    if (seen.has(key) || previous) {
      if (policy === 'merge' && previous) {
        previous.tags = [...new Set([...previous.tags, ...item.tags])]
        if (!previous.description && item.description) previous.description = item.description
        if (previous.title === previous.url && item.title !== item.url) previous.title = item.title
        if (previous.folderPath.length === 0 && item.folderPath.length > 0) previous.folderPath = item.folderPath
      } else {
        skipped++
      }
      continue
    }
    seen.add(key)
    const accepted = { ...item, folderPath: [...item.folderPath], tags: [...item.tags] }
    acceptedByKey.set(key, accepted)
    output.push(accepted)
  }
  return { items: output, skipped }
}
