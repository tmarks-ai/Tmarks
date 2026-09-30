import type {
  PublicBookmarkDTO,
  PublicBookmarkFolderDTO,
  PublicSharePageDTO,
  PublicShareSettingsDTO,
  UpdatePublicShareSettingsInput,
} from '@tmarks/contracts'
import { generateUUID } from '../crypto'
import { buildFolderTree, fetchBookmarkFolderStats, fetchBookmarkFolders, fetchBookmarkTags, normalizeBookmark } from '../bookmarks'
import { generateSlug } from '../utils'
import { sanitizeString } from '../validation'
import type { BookmarkFolder, BookmarkRow } from '../types'

interface PublicShareRow {
  id: string
  user_id: string
  slug: string
  enabled: number
  title: string | null
  description: string | null
  created_at: string
  updated_at: string
}

export class PublicShareSettingsError extends Error {
  constructor(public readonly code: 'VALIDATION_FAILED' | 'CONFLICT', message: string, public readonly status: 400 | 409 = 400) {
    super(message)
    this.name = 'PublicShareSettingsError'
  }
}

/**
 * R5-P3 (assertSlugAvailable TOCTOU): two concurrent updates choosing the
 * same slug both passed the SELECT precheck; the loser then surfaced as a
 * raw 500 from the UNIQUE constraint. Map the constraint failure (SQLite
 * error 19, D1 surfaces "UNIQUE constraint failed") to the typed 409 the
 * route already knows how to answer — mirroring register.ts's race handling.
 */
function uniqueSlugError(error: unknown, slug: string): PublicShareSettingsError {
  const message = error instanceof Error ? error.message : String(error)
  if (message.includes('UNIQUE constraint failed')) {
    return new PublicShareSettingsError('CONFLICT', `Slug "${slug}" is already taken`, 409)
  }
  throw error
}

export async function getPublicShareSettings(db: D1Database, userId: string): Promise<PublicShareSettingsDTO> {
  const row = await db.prepare(
    'SELECT id, user_id, slug, enabled, title, description, created_at, updated_at FROM public_share_pages WHERE user_id = ?',
  ).bind(userId).first<PublicShareRow>()
  return row ? mapSettings(row) : { enabled: false, slug: null, title: null, description: null, updated_at: null }
}

export async function updatePublicShareSettings(
  db: D1Database,
  userId: string,
  input: UpdatePublicShareSettingsInput,
): Promise<PublicShareSettingsDTO> {
  const current = await db.prepare(
    'SELECT id, user_id, slug, enabled, title, description, created_at, updated_at FROM public_share_pages WHERE user_id = ?',
  ).bind(userId).first<PublicShareRow>()
  const slug = await resolveSlug(db, userId, current?.slug ?? null, input)
  const title = input.title === undefined ? current?.title ?? null : nullableText(input.title, 200)
  const description = input.description === undefined ? current?.description ?? null : nullableText(input.description, 500)
  const enabled = input.enabled === undefined ? Number(current?.enabled ?? 0) : input.enabled ? 1 : 0
  const now = new Date().toISOString()

  if (!current) {
    try {
      await db.prepare(
        `INSERT INTO public_share_pages (id, user_id, slug, enabled, title, description, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(generateUUID(), userId, slug, enabled, title, description, now, now).run()
    } catch (error) {
      throw uniqueSlugError(error, slug)
    }
  } else {
    try {
      await db.prepare(
        `UPDATE public_share_pages
         SET slug = ?, enabled = ?, title = ?, description = ?, updated_at = ?
         WHERE user_id = ?`,
      ).bind(slug, enabled, title, description, now, userId).run()
    } catch (error) {
      throw uniqueSlugError(error, slug)
    }
  }

  const updated = await db.prepare(
    'SELECT id, user_id, slug, enabled, title, description, created_at, updated_at FROM public_share_pages WHERE user_id = ?',
  ).bind(userId).first<PublicShareRow>()
  if (!updated) throw new Error('Failed to save public share settings')
  return mapSettings(updated)
}

export async function fetchPublicSharePage(db: D1Database, slug: string): Promise<PublicSharePageDTO | null> {
  const page = await db.prepare(
    `SELECT id, user_id, slug, enabled, title, description, created_at, updated_at
     FROM public_share_pages WHERE slug = ? COLLATE NOCASE AND enabled = 1`,
  ).bind(slug.toLowerCase()).first<PublicShareRow>()
  if (!page) return null

  const [folders, folderStats, bookmarkResult] = await Promise.all([
    fetchBookmarkFolders(db, page.user_id, true),
    fetchBookmarkFolderStats(db, page.user_id, true),
    db.prepare(
      `SELECT * FROM bookmarks WHERE user_id = ? AND deleted_at IS NULL AND is_private = 0
       ORDER BY is_pinned DESC, pin_order ASC, updated_at DESC, id DESC`,
    ).bind(page.user_id).all<BookmarkRow>(),
  ])
  const rows = bookmarkResult.results || []
  const tagsByBookmark = await fetchBookmarkTags(db, page.user_id, rows.map((row) => row.id))
  const folderPath = createFolderPathResolver(folders)
  // Build the public DTO field by field instead of spreading the normalized
  // row: normalizeBookmark passes every DB column through, so a spread leaks
  // any column not named in BookmarkDTO (normalized_url today, anything a
  // future migration adds) into the public response.
  const bookmarks: PublicBookmarkDTO[] = rows.map((row) => {
    const b = normalizeBookmark(row)
    return {
      id: b.id,
      folder_id: b.folder_id,
      title: b.title,
      url: b.url,
      description: b.description,
      // Persisted images are content-addressed /api/public/assets/ paths —
      // the unauthenticated twin route — so they render as stored.
      cover_image: b.cover_image,
      favicon: b.favicon,
      is_pinned: b.is_pinned,
      pin_order: b.pin_order,
      is_archived: b.is_archived,
      is_todo: b.is_todo,
      position: b.position,
      click_count: b.click_count,
      last_clicked_at: b.last_clicked_at,
      revision: b.revision,
      folder_path: folderPath(row.folder_id),
      tags: tagsByBookmark.get(row.id) || [],
      created_at: b.created_at,
      updated_at: b.updated_at,
    }
  })
  const tags = await fetchPublicTagStats(db, page.user_id)
  const preferences = await db.prepare(
    'SELECT bookmark_nav_mode FROM user_preferences WHERE user_id = ?',
  ).bind(page.user_id).first<{ bookmark_nav_mode: 'folders' | 'tags' | null }>()

  return {
    share: { slug: page.slug, title: page.title, description: page.description, updated_at: page.updated_at },
    bookmarks,
    folders: buildFolderTree(folders).map(toPublicFolder),
    tags,
    folder_stats: folderStats,
    workspace: { nav_mode: preferences?.bookmark_nav_mode === 'tags' ? 'tags' : 'folders' },
  }
}

function mapSettings(row: PublicShareRow): PublicShareSettingsDTO {
  return { enabled: row.enabled === 1, slug: row.slug, title: row.title, description: row.description, updated_at: row.updated_at }
}


async function resolveSlug(db: D1Database, userId: string, currentSlug: string | null, input: UpdatePublicShareSettingsInput): Promise<string> {
  if (input.slug !== undefined && input.slug !== null && input.slug.trim()) {
    const normalized = normalizeSlug(input.slug)
    await assertSlugAvailable(db, userId, normalized)
    return normalized
  }
  // An explicit null (the share section sends `slug || null`) means "clear the
  // custom slug and mint a fresh one", same as regenerate_slug; omitting the
  // field keeps the current slug untouched.
  if (input.slug === null || input.regenerate_slug || !currentSlug) return generateUniqueSlug(db, userId)
  return currentSlug
}

function normalizeSlug(value: string): string {
  const slug = sanitizeString(value, 64).toLowerCase()
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
    throw new PublicShareSettingsError('VALIDATION_FAILED', 'Slug can only contain letters, numbers, and hyphens')
  }
  // Custom slugs are user-published identifiers: enforce a floor so a typo or
  // a trivial name does not become an enumerable share link.
  if (slug.replace(/-/g, '').length < 8) {
    throw new PublicShareSettingsError('VALIDATION_FAILED', 'Slug must be at least 8 characters long')
  }
  return slug
}

async function assertSlugAvailable(db: D1Database, userId: string, slug: string): Promise<void> {
  const row = await db.prepare('SELECT user_id FROM public_share_pages WHERE slug = ? COLLATE NOCASE').bind(slug).first<{ user_id: string }>()
  if (row && row.user_id !== userId) throw new PublicShareSettingsError('CONFLICT', 'Slug is already in use', 409)
}

async function generateUniqueSlug(db: D1Database, userId: string): Promise<string> {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const slug = generateSlug()
    const row = await db.prepare('SELECT user_id FROM public_share_pages WHERE slug = ? COLLATE NOCASE').bind(slug).first<{ user_id: string }>()
    if (!row || row.user_id === userId) return slug
  }
  throw new PublicShareSettingsError('CONFLICT', 'Failed to generate a public link')
}

function nullableText(value: string | null, maxLength: number): string | null {
  return value?.trim() ? sanitizeString(value, maxLength) : null
}

function toPublicFolder(folder: BookmarkFolder): PublicBookmarkFolderDTO {
  return {
    id: folder.id,
    name: folder.name,
    parent_id: folder.parent_id,
    position: folder.position,
    bookmark_count: folder.bookmark_count,
    created_at: folder.created_at,
    updated_at: folder.updated_at,
    ...(folder.children?.length ? { children: folder.children.map(toPublicFolder) } : {}),
  }
}

function createFolderPathResolver(folders: BookmarkFolder[]): (folderId: string | null) => string[] {
  const byId = new Map<string, BookmarkFolder>()
  for (const folder of folders) byId.set(folder.id, folder)
  return (folderId) => {
    const path: string[] = []
    let current = folderId ? byId.get(folderId) : undefined
    while (current && path.length < 8) {
      path.unshift(current.name)
      current = current.parent_id ? byId.get(current.parent_id) : undefined
    }
    return path
  }
}

async function fetchPublicTagStats(db: D1Database, userId: string) {
  const { results } = await db.prepare(
    `SELECT t.id, t.name, t.color, COUNT(DISTINCT bt.bookmark_id) AS bookmark_count
     FROM tags t
     INNER JOIN bookmark_tags bt ON bt.tag_id = t.id AND bt.user_id = t.user_id
     INNER JOIN bookmarks b ON b.id = bt.bookmark_id AND b.user_id = t.user_id
     WHERE t.user_id = ? AND t.deleted_at IS NULL AND b.deleted_at IS NULL AND b.is_private = 0
     GROUP BY t.id, t.name, t.color ORDER BY LOWER(t.name) ASC`,
  ).bind(userId).all<{ id: string; name: string; color: string | null; bookmark_count: number }>()
  return (results || []).map((tag) => ({ ...tag, bookmark_count: Number(tag.bookmark_count || 0) }))
}
