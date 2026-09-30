import type { SyncEntityType, SyncEnvelope, SyncOperationType } from '@tmarks/contracts'
import { generateUUID } from '../crypto'
import { clampText } from './sync-utils'
import type {
  BookmarkSyncPayload,
  SyncEntityRevisionRow,
  SyncEntityRow,
  TagSyncPayload,
} from './sync-types'

export async function recordSyncChange(
  db: D1Database,
  userId: string,
  deviceId: string,
  entityType: SyncEntityType,
  entityId: string,
  operation: SyncOperationType,
  revision: string,
  /** Callers that already hold the post-mutation payload (e.g. the sync push
   * built the row it just upserted) pass it here to skip the 2-query
   * read-back — the shape must match loadServerPayload byte-for-byte. */
  knownPayload?: unknown
): Promise<void> {
  const payload = knownPayload !== undefined ? knownPayload : await loadServerPayload(db, userId, entityType, entityId)
  await db
    .prepare(
      `INSERT INTO sync_changes
       (change_id, user_id, device_id, entity_type, entity_id, operation, revision, payload_json, changed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      generateUUID(),
      userId,
      deviceId,
      entityType,
      entityId,
      operation,
      revision,
      JSON.stringify(payload),
      new Date().toISOString()
    )
    .run()
}

async function getEntityRevision(
  db: D1Database,
  userId: string,
  entityType: SyncEntityType,
  entityId: string
): Promise<string | null> {
  const row = await db
    .prepare(
      `SELECT revision
       FROM sync_entity_revisions
       WHERE user_id = ? AND entity_type = ? AND entity_id = ?`
    )
    .bind(userId, entityType, entityId)
    .first<SyncEntityRevisionRow>()
  return row?.revision ?? null
}

export async function recordEntityRevision(
  db: D1Database,
  userId: string,
  entityType: SyncEntityType,
  entityId: string,
  revision: string,
  now: string
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO sync_entity_revisions
       (user_id, entity_type, entity_id, revision, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(user_id, entity_type, entity_id)
       DO UPDATE SET revision = excluded.revision, updated_at = excluded.updated_at`
    )
    .bind(userId, entityType, entityId, revision, now)
    .run()
}

export async function getExistingEntity(
  db: D1Database,
  userId: string,
  operation: SyncEnvelope
): Promise<SyncEntityRow | null> {
  if (operation.entity_type === 'bookmark') {
    const payload = operation.payload as BookmarkSyncPayload
    const existingById = await db
      .prepare('SELECT id, revision, deleted_at FROM bookmarks WHERE id = ? AND user_id = ?')
      .bind(operation.entity_id, userId)
      .first<SyncEntityRow>()
    if (existingById) return existingById

    if (payload.url) {
      return db
        .prepare('SELECT id, revision, deleted_at FROM bookmarks WHERE user_id = ? AND url = ?')
        .bind(userId, payload.url)
        .first<SyncEntityRow>()
    }
  }

  if (operation.entity_type === 'tab_group') {
    return db
      .prepare('SELECT id, revision, is_deleted FROM tab_groups WHERE id = ? AND user_id = ?')
      .bind(operation.entity_id, userId)
      .first<SyncEntityRow>()
  }

  if (operation.entity_type === 'bookmark_folder') {
    const folder = await db
      .prepare('SELECT id, is_deleted, deleted_at FROM bookmark_folders WHERE id = ? AND user_id = ?')
      .bind(operation.entity_id, userId)
      .first<SyncEntityRow>()
    if (!folder) return null
    const revision = await getEntityRevision(db, userId, 'bookmark_folder', folder.id)
    return { ...folder, revision }
  }

  if (operation.entity_type === 'tag') {
    const payload = operation.payload as TagSyncPayload
    const existingById = await db
      .prepare('SELECT id, deleted_at FROM tags WHERE id = ? AND user_id = ?')
      .bind(operation.entity_id, userId)
      .first<SyncEntityRow>()
    if (existingById) {
      const revision = await getEntityRevision(db, userId, 'tag', existingById.id)
      return { ...existingById, revision }
    }
    if (payload.name) {
      // 与 applyTagOperation 的 clampText(name, 50) 同口径:第二台设备推送同名
      // 的 51-64 字符标签时,已落库行是截断后的 50 前缀,按原始名字查找会 miss,
      // 随后撞名检测把本应归并的操作拒成 TAG_EXISTS。
      const name = clampText(payload.name, 50)
      if (!name) return null
      const existingByName = await db
        .prepare('SELECT id, deleted_at FROM tags WHERE user_id = ? AND name = ?')
        .bind(userId, name)
        .first<SyncEntityRow>()
      if (!existingByName) return null
      const revision = await getEntityRevision(db, userId, 'tag', existingByName.id)
      return { ...existingByName, revision }
    }
  }

  if (operation.entity_type === 'tab_group_item') {
    const item = await db
      .prepare(
        `SELECT tgi.id, tg.deleted_at, tg.is_deleted
         FROM tab_group_items tgi
         JOIN tab_groups tg ON tg.id = tgi.group_id
         WHERE tgi.id = ? AND tg.user_id = ?`
      )
      .bind(operation.entity_id, userId)
      .first<SyncEntityRow>()
    if (!item) return null
    const revision = await getEntityRevision(db, userId, 'tab_group_item', item.id)
    return { ...item, revision }
  }

  if (operation.entity_type === 'preference') {
    const preference = await db
      .prepare('SELECT user_id as id FROM user_preferences WHERE user_id = ?')
      .bind(userId)
      .first<SyncEntityRow>()
    if (!preference) return null
    const revision = await getEntityRevision(db, userId, 'preference', 'preferences')
    return { ...preference, id: 'preferences', revision }
  }

  return null
}

export async function loadServerPayload(
  db: D1Database,
  userId: string,
  entityType: SyncEntityType,
  entityId: string
): Promise<unknown> {
  if (entityType === 'bookmark') {
    const bookmark = await db
      .prepare(
        `SELECT id, title, url, description, folder_id, cover_image, favicon, is_pinned,
                pin_order, is_todo, is_archived, is_private, position,
                click_count, last_clicked_at, revision, created_at, updated_at, deleted_at
         FROM bookmarks
         WHERE id = ? AND user_id = ?`
      )
      .bind(entityId, userId)
      .first()
    if (!bookmark) return null

    const { results: tags } = await db
      .prepare(
        `SELECT t.id, t.name, t.color
         FROM tags t
         JOIN bookmark_tags bt ON bt.tag_id = t.id
         WHERE bt.bookmark_id = ? AND bt.user_id = ? AND t.deleted_at IS NULL
         ORDER BY t.name ASC`
      )
      .bind(entityId, userId)
      .all<Record<string, unknown>>()

    return { ...bookmark, tags: tags ?? [] }
  }

  if (entityType === 'bookmark_folder') {
    const folder = await db
      .prepare(
        `SELECT id, name, parent_id, position, is_deleted, deleted_at, created_at, updated_at
         FROM bookmark_folders
         WHERE id = ? AND user_id = ?`
      )
      .bind(entityId, userId)
      .first<Record<string, unknown>>()
    if (!folder) return null
    return { ...folder, revision: await getEntityRevision(db, userId, 'bookmark_folder', entityId) }
  }

  if (entityType === 'tag') {
    const tag = await db
      .prepare(
        `SELECT id, name, color, click_count, bookmark_count, last_clicked_at, created_at, updated_at, deleted_at
         FROM tags
         WHERE id = ? AND user_id = ?`
      )
      .bind(entityId, userId)
      .first<Record<string, unknown>>()
    if (!tag) return null
    return { ...tag, revision: await getEntityRevision(db, userId, 'tag', entityId) }
  }

  if (entityType === 'tab_group') {
    const group = await db
      .prepare(
        `SELECT id, title, parent_id, is_folder, position, color, tags, is_locked, revision, created_at, updated_at, deleted_at, is_deleted
         FROM tab_groups
         WHERE id = ? AND user_id = ?`
      )
      .bind(entityId, userId)
      .first<Record<string, unknown>>()

    if (!group) return null

    const { results: items } = await db
      .prepare(
        `SELECT tgi.id, tgi.group_id, tgi.title, tgi.url, tgi.favicon, tgi.position,
                tgi.is_pinned, tgi.is_todo, tgi.is_archived, tgi.created_at
         FROM tab_group_items tgi
         WHERE tgi.group_id = ? AND EXISTS (
           SELECT 1 FROM tab_groups tg WHERE tg.id = tgi.group_id AND tg.user_id = ?
         )
         ORDER BY tgi.position ASC`
      )
      .bind(entityId, userId)
      .all<Record<string, unknown>>()

    return {
      ...group,
      tabs: items ?? [],
    }
  }

  if (entityType === 'tab_group_item') {
    const item = await db
      .prepare(
        `SELECT tgi.id, tgi.group_id, tgi.title, tgi.url, tgi.favicon, tgi.position,
                tgi.is_pinned, tgi.is_todo, tgi.is_archived, tgi.created_at,
                COALESCE(tg.updated_at, tgi.created_at) as updated_at
         FROM tab_group_items tgi
         JOIN tab_groups tg ON tg.id = tgi.group_id
         WHERE tgi.id = ? AND tg.user_id = ?`
      )
      .bind(entityId, userId)
      .first<Record<string, unknown>>()
    if (!item) return null
    return { ...item, revision: await getEntityRevision(db, userId, 'tab_group_item', entityId) }
  }

  if (entityType === 'preference') {
    const preference = await db
      .prepare('SELECT * FROM user_preferences WHERE user_id = ?')
      .bind(userId)
      .first<Record<string, unknown>>()
    if (!preference) return null
    return { ...preference, id: 'preferences', revision: await getEntityRevision(db, userId, 'preference', 'preferences') }
  }

  return null
}
