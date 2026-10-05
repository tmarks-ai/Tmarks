import { generateUUID } from '../crypto'
import { chunkForD1In } from '../d1-chunk'

// Mirrors POST /tags' sanitizeString(name, 50): the bookmark plane reaches the
// same storage through resolveOrCreateTagIds and must not bypass the cap.
// Exported for the sync plane (R8 BL-4): its tag_names path sliced at 64 and
// minted overlong rows.
export const TAG_NAME_MAX_LENGTH = 50
// A bookmark carrying more tags than this is a client bug, not curation.
const TAGS_PER_BOOKMARK_MAX = 100

function normalizeTagNames(tagNames: string[]): string[] {
  const seen = new Set<string>()
  const normalized: string[] = []

  for (const rawName of tagNames) {
    // Truncate before dedupe: a 51-char name and its 50-char prefix are the
    // same tag once stored.
    const name = rawName.trim().slice(0, TAG_NAME_MAX_LENGTH)
    if (!name) continue

    const key = name.toLowerCase()
    if (seen.has(key)) continue

    seen.add(key)
    normalized.push(name)
    if (normalized.length >= TAGS_PER_BOOKMARK_MAX) break
  }

  return normalized
}

function uniqueTagIds(tagIds: string[]): string[] {
  const seen = new Set<string>()
  const uniqueIds: string[] = []

  for (const rawId of tagIds) {
    const tagId = rawId.trim()
    if (!tagId || seen.has(tagId)) continue

    seen.add(tagId)
    uniqueIds.push(tagId)
  }

  return uniqueIds
}

export async function getValidTagIds(
  db: D1Database,
  userId: string,
  tagIds: string[]
): Promise<string[]> {
  const requestedIds = uniqueTagIds(tagIds)
  if (requestedIds.length === 0) return []

  // D1 caps bound parameters at 100/query: bulk tag lists used to 500 past
  // 99 ids. Chunk the validation read.
  const validIds = new Set<string>()
  for (const chunk of chunkForD1In(requestedIds, 1)) {
    const placeholders = chunk.map(() => '?').join(',')
    const { results } = await db.prepare(
      `SELECT id
       FROM tags
       WHERE id IN (${placeholders}) AND user_id = ? AND deleted_at IS NULL`
    )
      .bind(...chunk, userId)
      .all<{ id: string }>()
    for (const row of results || []) validIds.add(row.id)
  }

  return requestedIds.filter((tagId) => validIds.has(tagId))
}

/**
 * Statement-returning core of resolveOrCreateTagIds: resolves existing tags by
 * name and builds (but does NOT execute) the statements for missing ones, so
 * the caller can fold tag materialization into a larger atomic batch.
 *
 * Name matching spans live AND tombstoned rows, mirroring the sync plane
 * (sync-operations' tag_names branch): a live hit is reused, a tombstone hit
 * is UNDELETED rather than duplicated — a fresh INSERT would die on
 * UNIQUE(user_id, name), which parks the name on the tombstone row. The
 * undelete fires the tag_trash_to_live trigger, which recomputes
 * bookmark_count from surviving links.
 */
export async function resolveOrCreateTagIdStatements(
  db: D1Database,
  userId: string,
  tagNames: string[],
  now: string = new Date().toISOString()
): Promise<{ tagIds: string[]; createStatements: D1PreparedStatement[] }> {
  const normalizedNames = normalizeTagNames(tagNames)
  if (normalizedNames.length === 0) return { tagIds: [], createStatements: [] }

  // Live rows first, then oldest-tombstone-first: the first row per name is
  // the preferred candidate even when case variants coexist. Chunked against
  // D1's 100-bound-parameter cap (user + N names).
  const existingTags: Array<{ id: string; name: string; deleted_at: string | null }> = []
  for (const chunk of chunkForD1In(normalizedNames, 1)) {
    const placeholders = chunk.map(() => '?').join(',')
    const { results } = await db.prepare(
      `SELECT id, name, deleted_at
       FROM tags
       WHERE user_id = ? AND LOWER(name) IN (${placeholders})
       ORDER BY deleted_at IS NULL DESC, updated_at ASC`
    )
      .bind(userId, ...chunk.map((name) => name.toLowerCase()))
      .all<{ id: string; name: string; deleted_at: string | null }>()
    existingTags.push(...(results || []))
  }

  const tagMap = new Map<string, { id: string; trashed: boolean }>()
  for (const tag of existingTags || []) {
    const key = tag.name.toLowerCase()
    const seen = tagMap.get(key)
    const trashed = tag.deleted_at !== null
    if (!seen || (seen.trashed && !trashed)) tagMap.set(key, { id: tag.id, trashed })
  }

  const createStatements: D1PreparedStatement[] = []
  for (const [key, entry] of tagMap) {
    if (!entry.trashed) continue
    createStatements.push(
      db
        .prepare('UPDATE tags SET deleted_at = NULL, updated_at = ? WHERE id = ? AND user_id = ?')
        .bind(now, entry.id, userId)
    )
    tagMap.set(key, { id: entry.id, trashed: false })
  }

  const tagsToCreate = normalizedNames.filter((name) => !tagMap.has(name.toLowerCase()))
  for (const name of tagsToCreate) {
    const tagId = generateUUID()
    tagMap.set(name.toLowerCase(), { id: tagId, trashed: false })
    createStatements.push(
      db
        .prepare('INSERT INTO tags (id, user_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
        .bind(tagId, userId, name, now, now)
    )
  }

  const tagIds = normalizedNames
    .map((name) => tagMap.get(name.toLowerCase())?.id)
    .filter((tagId): tagId is string => Boolean(tagId))
  return { tagIds, createStatements }
}

export async function resolveOrCreateTagIds(
  db: D1Database,
  userId: string,
  tagNames: string[],
  now: string = new Date().toISOString()
): Promise<string[]> {
  const { tagIds, createStatements } = await resolveOrCreateTagIdStatements(db, userId, tagNames, now)
  if (createStatements.length > 0) {
    await db.batch(createStatements)
  }
  return tagIds
}

export function buildReplaceBookmarkTagsStatements(
  db: D1Database,
  bookmarkId: string,
  userId: string,
  tagIds: string[],
  now: string = new Date().toISOString()
): D1PreparedStatement[] {
  const normalizedIds = uniqueTagIds(tagIds)
  const statements: D1PreparedStatement[] = [
    db.prepare('DELETE FROM bookmark_tags WHERE bookmark_id = ? AND user_id = ?')
      .bind(bookmarkId, userId),
  ]

  for (const tagId of normalizedIds) {
    statements.push(
      db
        .prepare('INSERT OR IGNORE INTO bookmark_tags (bookmark_id, tag_id, user_id, created_at) VALUES (?, ?, ?, ?)')
        .bind(bookmarkId, tagId, userId, now)
    )
  }

  return statements
}

export async function replaceBookmarkTags(
  db: D1Database,
  bookmarkId: string,
  userId: string,
  tagIds: string[],
  now: string = new Date().toISOString()
): Promise<void> {
  await db.batch(buildReplaceBookmarkTagsStatements(db, bookmarkId, userId, tagIds, now))
}

export async function replaceBookmarkTagsByNames(
  db: D1Database,
  bookmarkId: string,
  tagNames: string[],
  userId: string,
  now: string = new Date().toISOString()
): Promise<void> {
  const tagIds = await resolveOrCreateTagIds(db, userId, tagNames, now)
  await replaceBookmarkTags(db, bookmarkId, userId, tagIds, now)
}
