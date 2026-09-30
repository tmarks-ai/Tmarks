import type { ExistingFolderContext } from './types'

interface FolderRecord {
  id: string
  name: string
  parentId: string | null
}

export function buildExistingBookmarkFolderContext(
  folders: FolderRecord[],
  maxDepth = 2,
): ExistingFolderContext[] {
  const byId = new Map(folders.map((folder) => [folder.id, folder]))
  const seen = new Set<string>()
  const result: ExistingFolderContext[] = []

  for (const folder of folders) {
    const path = buildBookmarkFolderPath(folder, byId, maxDepth)
    if (path.length === 0) continue
    const key = path.map((part) => part.toLowerCase()).join('/')
    if (seen.has(key)) continue
    seen.add(key)
    result.push({ name: path[path.length - 1], path })
  }

  return result
}

function buildBookmarkFolderPath(
  folder: FolderRecord,
  byId: Map<string, FolderRecord>,
  maxDepth: number,
): string[] {
  const parts = [folder.name]
  const visited = new Set([folder.id])
  let current = folder.parentId ? byId.get(folder.parentId) : undefined

  while (current && !visited.has(current.id)) {
    visited.add(current.id)
    parts.unshift(current.name)
    current = current.parentId ? byId.get(current.parentId) : undefined
  }

  return parts.slice(-Math.max(1, maxDepth))
}
