import { EXPORT_VERSION } from '@tmarks/contracts'
import type {
  TMarksExportData,
  ExportBookmark,
  ExportBookmarkFolder,
  ExportTag,
  ExportTabGroup,
  ExportTabGroupItem,
  ExportScope,
} from '@tmarks/contracts'

const DEFAULT_TAG_COLOR = '#3b82f6'

interface CollectExportOptions {
  includeDeleted: boolean
}

function parseMaybeJsonStringArray(raw: unknown): string[] | undefined {
  if (raw == null) return undefined
  if (Array.isArray(raw)) return raw.map(String)
  if (typeof raw !== 'string') return undefined
  try {
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed)) return parsed.map(String)
    return undefined
  } catch {
    return undefined
  }
}

async function collectBookmarksAndTags(
  db: D1Database,
  userId: string,
  includeDeleted: boolean
): Promise<{ bookmarks: ExportBookmark[]; tags: ExportTag[] }> {
  const bookmarkWhere = includeDeleted ? 'user_id = ?' : 'user_id = ? AND deleted_at IS NULL'
  const tagWhere = includeDeleted ? 'user_id = ?' : 'user_id = ? AND deleted_at IS NULL'

  const { results: bookmarks } = await db
    .prepare(
      `SELECT id, folder_id, title, url, description, cover_image, favicon,
              is_pinned, is_archived, is_todo, is_private, position,
              click_count, last_clicked_at,
              created_at, updated_at, deleted_at
       FROM bookmarks WHERE ${bookmarkWhere} ORDER BY created_at DESC`
    )
    .bind(userId)
    .all()

  const { results: tags } = await db
    .prepare(
      `SELECT id, name, color, click_count, last_clicked_at, created_at, updated_at, deleted_at
       FROM tags WHERE ${tagWhere} ORDER BY name ASC`
    )
    .bind(userId)
    .all()

  const bookmarkTagSql = includeDeleted
    ? `SELECT bt.bookmark_id, bt.tag_id, t.name as tag_name
       FROM bookmark_tags bt JOIN tags t ON bt.tag_id = t.id
       WHERE bt.user_id = ?`
    : `SELECT bt.bookmark_id, bt.tag_id, t.name as tag_name
       FROM bookmark_tags bt
       JOIN tags t ON bt.tag_id = t.id
       JOIN bookmarks b ON bt.bookmark_id = b.id
       WHERE bt.user_id = ? AND t.deleted_at IS NULL AND b.deleted_at IS NULL`

  const { results: bookmarkTags } = await db.prepare(bookmarkTagSql).bind(userId).all()

  const bookmarkTagMap = new Map<string, string[]>()
  const tagCountMap = new Map<string, number>()

  bookmarkTags?.forEach((bt: Record<string, unknown>) => {
    const bookmarkId = String(bt.bookmark_id)
    const tagName = String(bt.tag_name)
    const list = bookmarkTagMap.get(bookmarkId) ?? []
    list.push(tagName)
    bookmarkTagMap.set(bookmarkId, list)
  })

  for (const tagList of bookmarkTagMap.values()) {
    for (const tagName of tagList) {
      tagCountMap.set(tagName, (tagCountMap.get(tagName) ?? 0) + 1)
    }
  }

  const exportBookmarks: ExportBookmark[] = (bookmarks || []).map((bookmark: Record<string, unknown>) => ({
    id: String(bookmark.id),
    folder_id: (bookmark.folder_id ?? null) as string | null,
    title: String(bookmark.title),
    url: String(bookmark.url),
    description: (bookmark.description ?? null) as string | null,
    cover_image: (bookmark.cover_image ?? null) as string | null,
    favicon: (bookmark.favicon ?? null) as string | null,
    tags: bookmarkTagMap.get(String(bookmark.id)) || [],
    is_pinned: Boolean(bookmark.is_pinned),
    is_archived: Boolean(bookmark.is_archived),
    // R8 CA-3: the export is the migration/backup format — dropping these
    // made a JSON export lossy (a private bookmark re-imported anywhere
    // came back public; the extension's local export already kept them).
    is_todo: Boolean(bookmark.is_todo),
    is_private: Boolean(bookmark.is_private),
    position: Number(bookmark.position ?? 0),
    click_count: Number(bookmark.click_count ?? 0),
    last_clicked_at: (bookmark.last_clicked_at ?? null) as string | null,
    created_at: String(bookmark.created_at),
    updated_at: String(bookmark.updated_at),
    deleted_at: (bookmark.deleted_at ?? null) as string | null,
  }))

  const exportTags: ExportTag[] = (tags || []).map((tag: Record<string, unknown>) => ({
    id: String(tag.id),
    name: String(tag.name),
    color: tag.color == null || tag.color === '' ? DEFAULT_TAG_COLOR : String(tag.color),
    click_count: Number(tag.click_count ?? 0),
    last_clicked_at: (tag.last_clicked_at ?? null) as string | null,
    created_at: String(tag.created_at),
    updated_at: String(tag.updated_at),
    deleted_at: (tag.deleted_at ?? null) as string | null,
    bookmark_count: tagCountMap.get(String(tag.name)) ?? 0,
  }))

  return { bookmarks: exportBookmarks, tags: exportTags }
}

async function collectBookmarkFolders(
  db: D1Database,
  userId: string,
  includeDeleted: boolean
): Promise<ExportBookmarkFolder[]> {
  const where = includeDeleted ? 'user_id = ?' : 'user_id = ? AND is_deleted = 0'
  const { results: folders } = await db
    .prepare(
      `SELECT id, name, parent_id, position, is_deleted, deleted_at, created_at, updated_at
       FROM bookmark_folders WHERE ${where}
       ORDER BY COALESCE(parent_id, ''), position ASC, lower(name) ASC`
    )
    .bind(userId)
    .all()

  return (folders || []).map((folder: Record<string, unknown>) => ({
    id: String(folder.id),
    name: String(folder.name),
    parent_id: (folder.parent_id ?? null) as string | null,
    position: Number(folder.position ?? 0),
    is_deleted: Boolean(folder.is_deleted),
    deleted_at: (folder.deleted_at ?? null) as string | null,
    created_at: String(folder.created_at),
    updated_at: String(folder.updated_at),
  }))
}

async function collectTabGroups(
  db: D1Database,
  userId: string,
  includeDeleted: boolean
): Promise<ExportTabGroup[]> {
  const where = includeDeleted ? 'user_id = ?' : 'user_id = ? AND is_deleted = 0'
  const { results: tabGroups } = await db
    .prepare(
      `SELECT id, title, parent_id, is_folder, position, color, tags, is_deleted, deleted_at, created_at, updated_at
       FROM tab_groups WHERE ${where} ORDER BY position ASC`
    )
    .bind(userId)
    .all()

  const { results: tabGroupItems } = await db
    .prepare(
      `SELECT tgi.id, tgi.group_id, tgi.title, tgi.url, tgi.favicon, tgi.position,
              tgi.is_pinned, tgi.is_todo, tgi.is_archived, tgi.created_at
       FROM tab_group_items tgi
       JOIN tab_groups tg ON tgi.group_id = tg.id
       WHERE tg.user_id = ? ${includeDeleted ? '' : 'AND tg.is_deleted = 0'}
       ORDER BY tgi.position ASC`
    )
    .bind(userId)
    .all()

  const groupItemsMap = new Map<string, ExportTabGroupItem[]>()
  tabGroupItems?.forEach((item: Record<string, unknown>) => {
    const groupId = String(item.group_id)
    const list = groupItemsMap.get(groupId) ?? []
    list.push({
      id: String(item.id),
      title: String(item.title),
      url: String(item.url),
      favicon: item.favicon ? String(item.favicon) : undefined,
      position: Number(item.position),
      is_pinned: Boolean(item.is_pinned),
      is_todo: Boolean(item.is_todo),
      is_archived: Boolean(item.is_archived),
      created_at: String(item.created_at),
    })
    groupItemsMap.set(groupId, list)
  })

  return (tabGroups || []).map((group: Record<string, unknown>) => ({
    id: String(group.id),
    title: String(group.title),
    parent_id: group.parent_id ? String(group.parent_id) : undefined,
    is_folder: Boolean(group.is_folder),
    position: Number(group.position),
    color: group.color ? String(group.color) : undefined,
    tags: parseMaybeJsonStringArray(group.tags),
    is_deleted: Boolean(group.is_deleted),
    deleted_at: group.deleted_at ? String(group.deleted_at) : undefined,
    created_at: String(group.created_at),
    updated_at: String(group.updated_at),
    items: groupItemsMap.get(String(group.id)) || [],
  }))
}

export async function collectExportData(
  db: D1Database,
  userId: string,
  scope: ExportScope,
  options: CollectExportOptions
): Promise<TMarksExportData> {
  const exportedAt = new Date().toISOString()
  const { includeDeleted } = options

  const shouldBookmarks = scope === 'all' || scope === 'bookmarks'
  const shouldTabGroups = scope === 'all' || scope === 'tab_groups'

  const [{ bookmarks, tags }, bookmark_folders, tab_groups] = await Promise.all([
    shouldBookmarks
      ? collectBookmarksAndTags(db, userId, includeDeleted)
      : Promise.resolve({ bookmarks: [], tags: [] }),
    shouldBookmarks ? collectBookmarkFolders(db, userId, includeDeleted) : Promise.resolve([] as ExportBookmarkFolder[]),
    shouldTabGroups ? collectTabGroups(db, userId, includeDeleted) : Promise.resolve([] as ExportTabGroup[]),
  ])

  return {
    version: EXPORT_VERSION,
    format: 'tmarks' as const,
    exported_at: exportedAt,
    bookmarks,
    bookmark_folders,
    tags,
    tab_groups,
    metadata: {
      total_bookmarks: bookmarks.length,
      total_bookmark_folders: bookmark_folders.length,
      total_tags: tags.length,
      total_tab_groups: tab_groups.length,
      export_format: 'json',
      source: 'tmarks',
    },
  }
}
