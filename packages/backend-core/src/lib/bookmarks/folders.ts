import type { BookmarkFolder, BookmarkFolderRow } from '../types'
import { generateUUID } from '../crypto'
import { emitSyncChange } from '../sync/sync-emit'

type FolderResolution =
  | { ok: true; folderId: string | null }
  | { ok: false; message: string }

type FolderPathResolution =
  | { ok: true; folderId: string | null; path: string[] }
  | { ok: false; message: string }

export function mapFolderRow(row: BookmarkFolderRow): BookmarkFolder {
  return {
    id: row.id,
    user_id: row.user_id,
    name: row.name,
    parent_id: row.parent_id ?? null,
    position: Number(row.position || 0),
    bookmark_count: Number(row.bookmark_count || 0),
    created_at: row.created_at,
    updated_at: row.updated_at,
    deleted_at: row.deleted_at ?? null,
  }
}

export function buildFolderTree(folders: BookmarkFolder[]): BookmarkFolder[] {
  const byId = new Map<string, BookmarkFolder>()
  const roots: BookmarkFolder[] = []

  for (const folder of folders) {
    byId.set(folder.id, { ...folder, children: [] })
  }

  for (const folder of byId.values()) {
    if (folder.parent_id && byId.has(folder.parent_id)) {
      byId.get(folder.parent_id)!.children!.push(folder)
    } else {
      roots.push(folder)
    }
  }

  return sortFolders(roots)
}

export async function fetchBookmarkFolders(
  db: D1Database,
  userId: string,
  publicOnly = false,
): Promise<BookmarkFolder[]> {
  if (publicOnly) {
    const { results } = await db.prepare(
      `WITH RECURSIVE public_folder_ids(id) AS (
         SELECT DISTINCT b.folder_id
         FROM bookmarks b
         WHERE b.user_id = ? AND b.deleted_at IS NULL AND b.is_private = 0
           AND b.folder_id IS NOT NULL
         UNION
         SELECT f.parent_id
         FROM bookmark_folders f
         JOIN public_folder_ids p ON p.id = f.id
         WHERE f.user_id = ? AND f.is_deleted = 0 AND f.parent_id IS NOT NULL
       )
       SELECT f.*, COUNT(b.id) as bookmark_count
       FROM bookmark_folders f
       LEFT JOIN bookmarks b ON b.folder_id = f.id
         AND b.user_id = f.user_id
         AND b.deleted_at IS NULL
         AND b.is_private = 0
       WHERE f.user_id = ? AND f.is_deleted = 0
         AND f.id IN (SELECT id FROM public_folder_ids)
       GROUP BY f.id
       ORDER BY COALESCE(f.parent_id, ''), f.position ASC, lower(f.name) ASC`
    )
      .bind(userId, userId, userId)
      .all<BookmarkFolderRow>()

    return (results || []).map(mapFolderRow)
  }

  const { results } = await db.prepare(
    `SELECT f.*, COUNT(b.id) as bookmark_count
     FROM bookmark_folders f
     LEFT JOIN bookmarks b ON b.folder_id = f.id
       AND b.user_id = f.user_id
       AND b.deleted_at IS NULL
     WHERE f.user_id = ? AND f.is_deleted = 0
     GROUP BY f.id
     ORDER BY COALESCE(f.parent_id, ''), f.position ASC, lower(f.name) ASC`
  )
    .bind(userId)
    .all<BookmarkFolderRow>()

  return (results || []).map(mapFolderRow)
}

export async function fetchBookmarkFolderStats(
  db: D1Database,
  userId: string,
  publicOnly = false,
): Promise<{ total_count: number; uncategorized_count: number }> {
  const privacy = publicOnly ? ' AND is_private = 0' : ''
  // One GROUP BY scan instead of two COUNTs: both counts derive from the same
  // filtered set, and D1 bills scanned rows per query — two full scans became
  // one (halved the read cost of every folders/sidebar render and share view).
  const { results } = await db.prepare(
    `SELECT folder_id IS NULL AS uncategorized, COUNT(*) as count
     FROM bookmarks
     WHERE user_id = ? AND deleted_at IS NULL${privacy}
     GROUP BY folder_id IS NULL`
  )
    .bind(userId)
    .all<{ uncategorized: 0 | 1; count: number }>()

  let totalCount = 0
  let uncategorizedCount = 0
  for (const row of results || []) {
    totalCount += Number(row.count)
    if (row.uncategorized === 1) uncategorizedCount = Number(row.count)
  }
  return { total_count: totalCount, uncategorized_count: uncategorizedCount }
}

export async function resolveBookmarkFolderId(
  db: D1Database,
  userId: string,
  folderId: string | null | undefined
): Promise<FolderResolution> {
  if (folderId === undefined) return { ok: true, folderId: null }
  if (folderId === null || folderId === '' || folderId === 'none') {
    return { ok: true, folderId: null }
  }

  const folder = await db.prepare(
    'SELECT id FROM bookmark_folders WHERE id = ? AND user_id = ? AND is_deleted = 0'
  )
    .bind(folderId, userId)
    .first<{ id: string }>()

  if (!folder) {
    return { ok: false, message: 'Folder not found' }
  }
  return { ok: true, folderId: folder.id }
}

export async function resolveBookmarkFolderPath(
  db: D1Database,
  userId: string,
  folderPath: string[] | null | undefined,
  now: string
): Promise<FolderPathResolution> {
  const path = normalizeFolderPath(folderPath)
  if (path.length === 0) {
    return { ok: true, folderId: null, path: [] }
  }

  let parentId: string | null = null
  let folderId: string | null = null

  for (const name of path) {
    const existing = await findFolderByName(db, userId, name, parentId)
    if (existing) {
      folderId = existing.id
      parentId = existing.id
      continue
    }

    const next = await db.prepare(
      `SELECT COALESCE(MAX(position), -1) + 1 as position
       FROM bookmark_folders
       WHERE user_id = ? AND is_deleted = 0
         AND ${parentId ? 'parent_id = ?' : 'parent_id IS NULL'}`
    )
      .bind(...(parentId ? [userId, parentId] : [userId]))
      .first<{ position: number }>()

    folderId = generateUUID()
    await db.prepare(
      `INSERT INTO bookmark_folders
       (id, user_id, name, parent_id, position, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(folderId, userId, name, parentId, next?.position || 0, now, now)
      .run()

    // Folders auto-created here (import, AI classification) are real user data;
    // without a change record the extension would receive bookmarks pointing at
    // a folder it has never heard of.
    await emitSyncChange(db, userId, 'bookmark_folder', folderId, 'upsert')

    parentId = folderId
  }

  return { ok: true, folderId, path }
}

export async function getBookmarkFolderPath(
  db: D1Database,
  userId: string,
  folderId: string | null | undefined
): Promise<string[]> {
  if (!folderId) return []

  const row = await db.prepare(
    `SELECT child.name as child_name, parent.name as parent_name
     FROM bookmark_folders child
     LEFT JOIN bookmark_folders parent ON parent.id = child.parent_id
     WHERE child.id = ? AND child.user_id = ? AND child.is_deleted = 0`
  )
    .bind(folderId, userId)
    .first<{ child_name: string; parent_name: string | null }>()

  if (!row) return []
  return [row.parent_name, row.child_name].filter((value): value is string => Boolean(value))
}

export async function validateFolderParent(
  db: D1Database,
  userId: string,
  parentId: string | null | undefined
): Promise<FolderResolution> {
  if (!parentId) return { ok: true, folderId: null }
  const parent = await db.prepare(
    'SELECT id, parent_id FROM bookmark_folders WHERE id = ? AND user_id = ? AND is_deleted = 0'
  )
    .bind(parentId, userId)
    .first<{ id: string; parent_id: string | null }>()

  if (!parent) return { ok: false, message: 'Parent folder not found' }
  if (parent.parent_id) return { ok: false, message: 'Only primary and secondary folder levels are supported; bookmarks are the third level' }
  return { ok: true, folderId: parent.id }
}

function sortFolders(folders: BookmarkFolder[]): BookmarkFolder[] {
  return folders
    .sort(compareFolders)
    .map((folder) => ({ ...folder, children: sortFolders(folder.children || []) }))
}

function compareFolders(a: BookmarkFolder, b: BookmarkFolder) {
  if (a.position !== b.position) return a.position - b.position
  return a.name.localeCompare(b.name)
}

function normalizeFolderPath(folderPath: string[] | null | undefined): string[] {
  if (!Array.isArray(folderPath)) return []

  return folderPath
    .map(name => String(name).trim().slice(0, 120))
    .filter(Boolean)
    .slice(0, 2)
}

async function findFolderByName(
  db: D1Database,
  userId: string,
  name: string,
  parentId: string | null
): Promise<{ id: string } | null> {
  const query = parentId
    ? `SELECT id FROM bookmark_folders
       WHERE user_id = ? AND parent_id = ? AND lower(name) = lower(?) AND is_deleted = 0`
    : `SELECT id FROM bookmark_folders
       WHERE user_id = ? AND parent_id IS NULL AND lower(name) = lower(?) AND is_deleted = 0`

  return db.prepare(query)
    .bind(...(parentId ? [userId, parentId, name] : [userId, name]))
    .first<{ id: string }>()
}
