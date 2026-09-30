import type { SyncOperationType } from '@tmarks/contracts'
import { recordEntityRevision } from './sync-repository'
import type { BookmarkFolderSyncPayload, SyncApplyResult } from './sync-types'
import { clampText } from './sync-utils'

/**
 * Folder-tree invariants for the sync push plane.
 *
 * Mirrors the REST routes (folders/update.ts + validateFolderParent): no
 * self-parent, two-level structure only, and folders with children stay at
 * level one. Enforcing them here is what keeps buildFolderTree from silently
 * dropping cycle nodes pushed by an API-key client — and the two-level rule
 * makes cycles unreachable, since every cycle would need a node that is both
 * level one (a valid parent) and level two (has a parent).
 */
export async function syncFolderParentError(
  db: D1Database,
  userId: string,
  entityId: string,
  parentId: string
): Promise<string | null> {
  if (parentId === entityId) return 'Folder cannot be its own parent.'

  const parent = await db
    .prepare('SELECT id, parent_id FROM bookmark_folders WHERE id = ? AND user_id = ? AND is_deleted = 0')
    .bind(parentId, userId)
    .first<{ id: string; parent_id: string | null }>()
  if (!parent) return 'The parent folder was not found for this account.'
  if (parent.parent_id) {
    return 'Only primary and secondary folder levels are supported; bookmarks are the third level.'
  }

  const child = await db
    .prepare('SELECT id FROM bookmark_folders WHERE parent_id = ? AND user_id = ? AND is_deleted = 0 LIMIT 1')
    .bind(entityId, userId)
    .first()
  if (child) return 'Folders with children cannot be moved under another folder.'
  return null
}

export async function applyBookmarkFolderOperation(
  db: D1Database,
  userId: string,
  entityId: string,
  revision: string,
  now: string,
  payload: BookmarkFolderSyncPayload,
  operation: SyncOperationType
): Promise<SyncApplyResult> {
  if (operation === 'delete') {
    await db
      .prepare('UPDATE bookmark_folders SET is_deleted = 1, deleted_at = ?, updated_at = ? WHERE id = ? AND user_id = ?')
      .bind(now, now, entityId, userId)
      .run()
    await recordEntityRevision(db, userId, 'bookmark_folder', entityId, revision, now)
    return { ok: true }
  }

  // Guard cross-user IDOR: bookmark_folders.id is a global primary key, so a
  // caller reusing another user's entityId would hit ON CONFLICT(id) and
  // overwrite that row. Bail out when the id exists for a different owner.
  const owner = await db
    .prepare('SELECT user_id FROM bookmark_folders WHERE id = ?')
    .bind(entityId)
    .first<{ user_id: string }>()
  if (owner && owner.user_id !== userId) {
    return { ok: false, reason: 'The entity id belongs to a different account.' }
  }

  // REST 同口径目录不变量(自父/两级/有子不移动,见 syncFolderParentError):
  // 不校验时 API-key 客户端可推 parent_id=entityId 或互为父的目录,
  // buildFolderTree 会把环上节点从侧栏静默丢掉。
  if (payload.parent_id) {
    const error = await syncFolderParentError(db, userId, entityId, payload.parent_id)
    if (error) return { ok: false, reason: error }
  }

  // REST 同口径:目录名 120(sanitizeString(body.name, 120))。
  const name = clampText(payload.name, 120) ?? ''
  await db
    .prepare(
      `INSERT INTO bookmark_folders
       (id, user_id, name, parent_id, position, is_deleted, deleted_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 0, NULL, ?, ?)
       ON CONFLICT(id)
       DO UPDATE SET
         name = excluded.name,
         parent_id = excluded.parent_id,
         position = excluded.position,
         is_deleted = 0,
         deleted_at = NULL,
         updated_at = excluded.updated_at`
    )
    .bind(entityId, userId, name, payload.parent_id ?? null, payload.position ?? 0, now, now)
    .run()
  await recordEntityRevision(db, userId, 'bookmark_folder', entityId, revision, now)
  return { ok: true }
}
