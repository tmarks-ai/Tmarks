import type { SyncChange, SyncCursor, SyncEntityType } from '@tmarks/contracts'
import { getLatestSyncCursor } from './sync-cursor'
import { entityRowToBootstrapChange } from './sync-utils'

export interface SyncBootstrapChanges {
  bookmarks: SyncChange[]
  bookmark_folders: SyncChange[]
  tags: SyncChange[]
  tab_groups: SyncChange[]
  tab_group_items: SyncChange[]
  preferences: SyncChange[]
  cursor: SyncCursor
  page_cursor: string | null
  has_more: boolean
}

/** Entities per bootstrap page. A full-snapshot response was previously unbounded: a
 *  20k-bookmark account produced a ~14 MB payload in a single Worker invocation,
 *  every 24h, per device — and it grew linearly with the account. */
const DEFAULT_PAGE_SIZE = 2000
const MAX_PAGE_SIZE = 5000

/**
 * Paged in parent-before-child order so a page can be applied on arrival: a
 * bookmark referencing a folder never arrives before that folder.
 */
const PAGE_ORDER = [
  'bookmark_folder',
  'tag',
  'bookmark',
  'tab_group',
  'tab_group_item',
] as const satisfies readonly SyncEntityType[]

type PagedEntityType = (typeof PAGE_ORDER)[number]

const ENTITY_QUERIES: Record<PagedEntityType, string> = {
  // R8 BL-3: folder/tag/tab_group_item rows carry no revision column, so the
  // snapshot used to synthesize `rev_<Date.now()>` for every row — any push
  // carrying that base_revision guaranteed a false revision_mismatch. LEFT
  // JOIN the entity-revision registry instead: real revision when tracked,
  // null otherwise (the client treats null as last-write-wins, the same
  // semantic the conflict plane already documents for server_revision).
  bookmark_folder: `SELECT f.id, f.name, f.parent_id, f.position, f.is_deleted, f.deleted_at, f.created_at, f.updated_at,
       ser.revision
     FROM bookmark_folders f
     LEFT JOIN sync_entity_revisions ser
       ON ser.user_id = f.user_id AND ser.entity_type = 'bookmark_folder' AND ser.entity_id = f.id
     WHERE f.user_id = ? AND f.id > ?
     ORDER BY f.id ASC LIMIT ?`,
  tag: `SELECT t.id, t.name, t.color, t.click_count, t.bookmark_count, t.last_clicked_at, t.created_at, t.updated_at, t.deleted_at,
       ser.revision
     FROM tags t
     LEFT JOIN sync_entity_revisions ser
       ON ser.user_id = t.user_id AND ser.entity_type = 'tag' AND ser.entity_id = t.id
     WHERE t.user_id = ? AND t.id > ?
     ORDER BY t.id ASC LIMIT ?`,
  bookmark: `SELECT id, title, url, description, folder_id, cover_image, favicon, is_pinned, pin_order,
            is_todo, is_archived, is_private, position,
            click_count, last_clicked_at, revision, created_at, updated_at, deleted_at
     FROM bookmarks
     WHERE user_id = ? AND id > ?
     ORDER BY id ASC LIMIT ?`,
  tab_group: `SELECT id, title, parent_id, is_folder, position, color, tags, is_locked, revision,
            created_at, updated_at, deleted_at, is_deleted
     FROM tab_groups
     WHERE user_id = ? AND id > ?
     ORDER BY id ASC LIMIT ?`,
  // tab_group_items has no user_id column, so there is no (user_id, id)
  // composite to seek. CROSS JOIN pins tgi as the OUTER loop: the PK range
  // (id > ?) then streams rows already in id ASC order (no TEMP B-TREE
  // re-sort) while the per-row group probe applies the user predicate.
  // A plain JOIN let the planner start from the groups index instead —
  // every page probed each group's items and re-sorted the whole batch
  // (EXPLAIN-verified; pinned in test/index-plan-regressions.test.ts).
  tab_group_item: `SELECT tgi.id, tgi.group_id, tgi.title, tgi.url, tgi.favicon, tgi.position,
            tgi.is_pinned, tgi.is_todo, tgi.is_archived, tgi.created_at,
            COALESCE(tg.updated_at, tgi.created_at) as updated_at,
            tg.is_deleted, tg.deleted_at,
            ser.revision
     FROM tab_group_items tgi
     CROSS JOIN tab_groups tg ON tg.id = tgi.group_id
     LEFT JOIN sync_entity_revisions ser
       ON ser.user_id = tg.user_id AND ser.entity_type = 'tab_group_item' AND ser.entity_id = tgi.id
     WHERE tg.user_id = ? AND tgi.id > ?
     ORDER BY tgi.id ASC LIMIT ?`,
}

/** Position within the paged walk, plus the sync cursor captured when it began. */
interface BootstrapPageToken {
  typeIndex: number
  lastId: string
  cursor: SyncCursor
}

function encodePageToken(token: BootstrapPageToken): string {
  return btoa(JSON.stringify(token))
}

function decodePageToken(raw: string | null): BootstrapPageToken | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(atob(raw)) as Partial<BootstrapPageToken>
    if (
      typeof parsed?.typeIndex !== 'number' ||
      typeof parsed?.lastId !== 'string' ||
      typeof parsed?.cursor !== 'string' ||
      parsed.typeIndex < 0 ||
      parsed.typeIndex > PAGE_ORDER.length
    ) {
      return null
    }
    return { typeIndex: parsed.typeIndex, lastId: parsed.lastId, cursor: parsed.cursor as SyncCursor }
  } catch {
    return null
  }
}

function emptyBuckets() {
  return {
    bookmarks: [] as SyncChange[],
    bookmark_folders: [] as SyncChange[],
    tags: [] as SyncChange[],
    tab_groups: [] as SyncChange[],
    tab_group_items: [] as SyncChange[],
    preferences: [] as SyncChange[],
  }
}

const BUCKET_BY_TYPE: Record<PagedEntityType, keyof ReturnType<typeof emptyBuckets>> = {
  bookmark_folder: 'bookmark_folders',
  tag: 'tags',
  bookmark: 'bookmarks',
  tab_group: 'tab_groups',
  tab_group_item: 'tab_group_items',
}

/**
 * One page of the full-state snapshot.
 *
 * The sync cursor is read *before* any snapshot query and then carried in the
 * page token. Reading it alongside the snapshots (the previous behaviour) left
 * their ordering undefined, so a change written between the two could be both
 * absent from the snapshot and below the stored cursor — lost until the next
 * bootstrap a day later.
 */
export async function bootstrapSyncChanges(
  db: D1Database,
  userId: string,
  options: { pageCursor?: string | null; pageSize?: number } = {}
): Promise<SyncBootstrapChanges> {
  const pageSize = Math.max(1, Math.min(options.pageSize ?? DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE))
  const token = decodePageToken(options.pageCursor ?? null)
  // A malformed token restarts the walk rather than silently skipping entities.
  const cursor = token?.cursor ?? (await getLatestSyncCursor(db, userId))

  const buckets = emptyBuckets()
  let typeIndex = token?.typeIndex ?? 0
  let lastId = token?.lastId ?? ''
  let remaining = pageSize

  while (typeIndex < PAGE_ORDER.length && remaining > 0) {
    const entityType = PAGE_ORDER[typeIndex]
    const requested = remaining
    const { results } = await db
      .prepare(ENTITY_QUERIES[entityType])
      .bind(userId, lastId, requested)
      .all<Record<string, unknown>>()
    const rows = results ?? []

    for (const row of rows) {
      buckets[BUCKET_BY_TYPE[entityType]].push(entityRowToBootstrapChange(entityType, row))
    }
    remaining -= rows.length

    if (rows.length < requested) {
      // Short read means this type is exhausted; continue with the next one.
      typeIndex += 1
      lastId = ''
    } else {
      lastId = String(rows[rows.length - 1].id)
    }
  }

  const done = typeIndex >= PAGE_ORDER.length
  // Preferences are a single row, emitted with the final page so a client that
  // stops early never sees a half-applied snapshot claiming to be complete.
  if (done) {
    const preferenceRow = await db
      .prepare('SELECT * FROM user_preferences WHERE user_id = ?')
      .bind(userId)
      .first<Record<string, unknown>>()
    if (preferenceRow) {
      buckets.preferences.push(entityRowToBootstrapChange('preference', { ...preferenceRow, id: 'preferences' }))
    }
  }

  return {
    ...buckets,
    cursor,
    has_more: !done,
    page_cursor: done ? null : encodePageToken({ typeIndex, lastId, cursor }),
  }
}
