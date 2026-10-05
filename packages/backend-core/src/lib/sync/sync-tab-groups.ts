import type { SyncOperationType } from '@tmarks/contracts'
import { generateUUID } from '../crypto'
import { sanitizeColor, sanitizeString, sanitizeUrl } from '../validation'
import type { SyncApplyResult, TabGroupSyncPayload } from './sync-types'
import { loadServerPayload } from './sync-repository'
import { recordGroupItemRevisions } from './sync-emit'
import { toBooleanInt } from './sync-utils'

export async function applyTabGroupOperation(
  db: D1Database,
  userId: string,
  entityId: string,
  revision: string,
  now: string,
  payload: TabGroupSyncPayload,
  operation: SyncOperationType
): Promise<SyncApplyResult> {
  if (operation === 'delete') {
    await db
      .prepare('UPDATE tab_groups SET is_deleted = 1, deleted_at = ?, revision = ?, updated_at = ? WHERE id = ? AND user_id = ?')
      .bind(now, revision, now, entityId, userId)
      .run()
    return { ok: true }
  }

  // Guard cross-user IDOR: tab_groups.id is a global primary key, so a caller
  // who reuses another user's entityId would otherwise hit ON CONFLICT(id) and
  // overwrite that row. Bail out when the id exists but belongs to someone else.
  const owner = await db
    .prepare('SELECT user_id FROM tab_groups WHERE id = ?')
    .bind(entityId)
    .first<{ user_id: string }>()
  if (owner && owner.user_id !== userId) {
    return { ok: false, reason: 'The entity id belongs to a different account.' }
  }

  // R8 BR-3/CA-2: locked groups reject all mutations except the unlock
  // operation itself — the sync push face bypassed the lock entirely, so an
  // extension edit to a web-locked group was silently accepted. Terminal code
  // + server state so the client can "accept remote" to recover.
  if (owner) {
    const existing = await db
      .prepare('SELECT is_locked FROM tab_groups WHERE id = ? AND user_id = ?')
      .bind(entityId, userId)
      .first<{ is_locked: number }>()
    if (existing?.is_locked) {
      return await rejectLockedGroup(db, userId, entityId)
    }
  }

  // Parent must belong to this user, mirroring the REST create/update routes;
  // a cross-user parent would corrupt the tree and leak titles via listings.
  // REST(batch-update) 同口径的自父/环防护(tab_groups 无 folders 的两级结构
  // 约束可兜底):沿 parent 链上溯 64 层。这类拒绝永远无法重推成功 → 独立
  // 终态 code + 附服务器当前状态,客户端据此可"接受远端"恢复。
  if (payload.parent_id) {
    if (payload.parent_id === entityId) {
      return await rejectParentTree(db, userId, entityId, 'A tab group cannot be its own parent.')
    }
    // R8 BR-1 同根因:已删(回收站中)的组不能作为新 parent。
    const parent = await db
      .prepare(
        'SELECT id FROM tab_groups WHERE id = ? AND user_id = ? AND (is_deleted IS NULL OR is_deleted = 0)',
      )
      .bind(payload.parent_id, userId)
      .first<{ id: string }>()
    if (!parent) return { ok: false, reason: 'The parent tab group was not found for this account.' }

    let current: string | null = payload.parent_id
    for (let depth = 0; depth < 64 && current; depth += 1) {
      if (current === entityId) {
        return await rejectParentTree(db, userId, entityId, 'Cannot move a tab group under its own descendant.')
      }
      const parentRow: { parent_id: string | null } | null = await db
        .prepare('SELECT parent_id FROM tab_groups WHERE id = ? AND user_id = ?')
        .bind(current, userId)
        .first<{ parent_id: string | null }>()
      current = parentRow?.parent_id ?? null
    }
  }

  await db
    .prepare(
      `INSERT INTO tab_groups
       (id, user_id, title, parent_id, is_folder, position, color, tags, is_deleted, revision, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)
       ON CONFLICT(id)
       DO UPDATE SET
         title = excluded.title,
         parent_id = excluded.parent_id,
         is_folder = excluded.is_folder,
         position = excluded.position,
         color = excluded.color,
         tags = excluded.tags,
         is_deleted = 0,
         deleted_at = NULL,
         revision = excluded.revision,
         updated_at = excluded.updated_at`
    )
    .bind(
      entityId,
      userId,
      payload.title,
      payload.parent_id ?? null,
      toBooleanInt(payload.is_folder),
      payload.position ?? 0,
      payload.color && typeof payload.color === 'string' ? sanitizeColor(payload.color) : null,
      // REST 同口径(≤50 项,每项 ≤50 字符)有界存储 tags JSON。
      payload.tags && Array.isArray(payload.tags)
        ? JSON.stringify(payload.tags.slice(0, 50).map((tag) => String(tag).slice(0, 50)))
        : null,
      revision,
      now,
      now
    )
    .run()

  if (Array.isArray(payload.tabs)) {
    // Drop non-http(s) tab URLs before insert; position follows the kept items.
    const kept = payload.tabs.filter((tab) => sanitizeUrl(tab.url))
    // The DELETE and the INSERTs land in ONE batch: a standalone DELETE meant
    // an isolate death (or a pushed tab id colliding with another group's item
    // PK) left the group EMPTY with the new revision already committed — the
    // retry then reads the bumped revision as a conflict and cannot re-apply,
    // while "accept remote" propagates the emptied group to every device.
    const statements: D1PreparedStatement[] = [
      db.prepare('DELETE FROM tab_group_items WHERE group_id = ?').bind(entityId),
    ]
    statements.push(
      ...kept.map((tab, index) =>
        db
          .prepare(
            `INSERT INTO tab_group_items (id, group_id, title, url, favicon, position, is_pinned, is_todo, is_archived, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .bind(
            tab.id ?? generateUUID(),
            entityId,
            sanitizeString(tab.title, 500),
            sanitizeUrl(tab.url),
            typeof tab.favicon === 'string' ? sanitizeString(tab.favicon, 2000) : null,
            tab.position ?? index,
            toBooleanInt(tab.is_pinned),
            toBooleanInt(tab.is_todo),
            toBooleanInt(tab.is_archived),
            now
          )
      )
    )
    await db.batch(statements)
  }
  // Re-stamp item revisions on EVERY group upsert, not just tabs-carrying
  // ones: the client stamps pulled items inside a group change with the
  // GROUP's revision unconditionally, so a metadata-only rename whose echo
  // arrives without tabs would leave server item revisions behind — and the
  // next item-level edit then trips a guaranteed false revision_mismatch.
  // Matches the REST plane (emitSyncChange re-stamps unconditionally).
  await recordGroupItemRevisions(db, userId, entityId, revision, now)
  return { ok: true }
}

/** 自父/环拒绝:终态 code + 服务器当前状态(供客户端"接受远端")。 */
async function rejectParentTree(
  db: D1Database,
  userId: string,
  entityId: string,
  reason: string
): Promise<SyncApplyResult> {
  const serverState = await loadServerPayload(db, userId, 'tab_group', entityId)
  return {
    ok: false,
    code: 'INVALID_PARENT_TREE',
    reason,
    ...(serverState ? { payload: serverState } : {}),
  }
}

/** 锁定拒绝(R8 BR-3/CA-2):终态 code + 服务器当前状态(供客户端"接受远端")。 */
async function rejectLockedGroup(
  db: D1Database,
  userId: string,
  entityId: string
): Promise<SyncApplyResult> {
  const serverState = await loadServerPayload(db, userId, 'tab_group', entityId)
  return {
    ok: false,
    code: 'RESOURCE_LOCKED',
    reason: 'Tab group is locked.',
    ...(serverState ? { payload: serverState } : {}),
  }
}
