import { normalizeFolderPart, normalizeFolderPath, splitFolderPath, uniqueStrings } from './folder-path'
import { parseTagInput } from './tag-input'
import type { ParsedBookmarkData } from './types'

export function parseAIResponse(content: string): ParsedBookmarkData {
  const parsed = parseAIResponseContent(content)
  if (!isPlainObject(parsed)) throw new Error('AI response JSON is not an object.')
  return normalizeParsedBookmarkData(parsed)
}

function parseAIResponseContent(content: string): unknown {
  const cleaned = content
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim()

  try {
    return JSON.parse(cleaned)
  } catch {
    for (const candidate of extractJsonCandidates(cleaned)) {
      try {
        return JSON.parse(repairJsonCandidate(candidate))
      } catch {
        // Try the next balanced candidate.
      }
    }
  }

  throw new Error('AI response is not valid JSON.')
}

function repairJsonCandidate(input: string): string {
  return input
    .replace(/,(\s*[}\]])/g, '$1')
    .replace(/\}(\s*)\{/g, '},$1{')
}

function extractJsonCandidates(input: string): string[] {
  const candidates: string[] = []
  // R8 CA-10: cap the number of scan starts. Every '{'/'[' scanned the
  // remainder of a 2MB hostile response to its end, making the loop O(n²) —
  // enough to freeze the popup for minutes. 16 candidate starts is generous
  // for any real fenced/mixed AI response; past that we bail.
  const MAX_CANDIDATE_STARTS = 16
  for (let start = 0; start < input.length && candidates.length < MAX_CANDIDATE_STARTS; start += 1) {
    if (input[start] !== '{' && input[start] !== '[') continue
    const candidate = extractBalancedJsonValue(input, start)
    if (candidate) candidates.push(candidate)
  }
  return candidates
}

function extractBalancedJsonValue(input: string, start: number): string | null {
  const opener = input[start]
  const closer = opener === '{' ? '}' : opener === '[' ? ']' : null
  if (!closer) return null

  const stack: string[] = []
  let inString = false
  let escaped = false

  for (let index = start; index < input.length; index += 1) {
    const char = input[index]
    if (inString) {
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else if (char === '"') inString = false
      continue
    }

    if (char === '"') {
      inString = true
      continue
    }
    if (char === '{' || char === '[') {
      stack.push(char === '{' ? '}' : ']')
      continue
    }
    if (char === '}' || char === ']') {
      const expected = stack.pop()
      if (char !== expected) return null
      if (stack.length === 0) return input.slice(start, index + 1)
    }
  }

  return null
}

function normalizeParsedBookmarkData(input: Record<string, unknown>): ParsedBookmarkData {
  const classification = readClassification(input)
  const folderPath = classification?.folderPath || readFolderPath(input)

  return {
    url: readString(input, ['url', 'URL', 'href', 'link']),
    title: readString(input, ['title', 'Title']) || '',
    description: readString(input, ['description', 'Description', 'summary']) || '',
    tags: readTags(input),
    folder: folderPath.join('/'),
    folderPath,
    confidence: readNumber(input, ['confidence', 'Confidence', 'score']),
    classification,
  }
}

function readClassification(input: Record<string, unknown>): ParsedBookmarkData['classification'] | undefined {
  const source = readObject(input, ['classification', 'Classification', 'categoryInfo', 'category'])
  const target = source || input
  const folderPath = readFolderPath(target)
  const primary = normalizeFolderPart(readString(target, ['primary', 'Primary', 'primaryCategory', 'level1'])) || folderPath[0]
  const secondary = normalizeFolderPart(readString(target, ['secondary', 'Secondary', 'secondaryCategory', 'level2'])) || folderPath[1]
  const normalizedPath = normalizeFolderPath([folderPath[0] || primary, folderPath[1] || secondary].filter(Boolean))

  if (!normalizedPath?.length) return undefined
  return {
    primary: normalizedPath[0],
    secondary: normalizedPath[1],
    folderPath: normalizedPath,
  }
}

function readFolderPath(input: Record<string, unknown>): string[] {
  for (const key of ['folderPath', 'folder_path', 'path']) {
    const value = input[key]
    if (Array.isArray(value)) return normalizeFolderPath(value) || []
  }
  const folder = readString(input, ['folder', 'Folder', 'categoryPath'])
  return folder ? splitFolderPath(folder) || [] : []
}

function readTags(input: Record<string, unknown>): string[] {
  const direct = input.tags || input.Tags || input.suggestedTags || input.recommendedTags
  if (typeof direct === 'string') return parseTagInput(direct, 12)
  if (!Array.isArray(direct)) return []
  return uniqueStrings(
    direct
      .flatMap((tag) => typeof tag === 'string' ? parseTagInput(tag, 12) : isPlainObject(tag) ? readString(tag, ['name', 'tag', 'label']) : undefined)
      .filter((tag): tag is string => Boolean(tag)),
  )
}

function readObject(input: Record<string, unknown>, keys: string[]): Record<string, unknown> | undefined {
  for (const key of keys) {
    const value = input[key]
    if (isPlainObject(value)) return value
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function readString(input: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = input[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
}

function readNumber(input: Record<string, unknown>, keys: string[]): number | undefined {
  for (const key of keys) {
    const value = input[key]
    const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN
    if (Number.isFinite(parsed)) return parsed > 1 && parsed <= 100 ? parsed / 100 : Math.max(0, Math.min(1, parsed))
  }
}
