import type { SyncOperationType } from '@tmarks/contracts'
import { sanitizeString, sanitizeUrl } from '../validation'
import type { SyncApplyResult, TabGroupItemSyncPayload } from './sync-types'
import { recordEntityRevision } from './sync-repository'
import { toBooleanInt } from './sync-utils'

/**
 * tab_group_item 的同步应用/校验(自 sync-tab-groups.ts 按实体拆分,无行为变化):
 * 删除、跨用户 IDOR 防护、组内插入/更新与父组存在性校验。
 */

export async function applyTabGroupItemOperation(
  db: D1Database,
  userId: string,
  entityId: string,
  revision: string,
  now: string,
  payload: TabGroupItemSyncPayload,
  operation: SyncOperationType
): Promise<SyncApplyResult> {
  if (operation === 'delete') {
    const groupId = await resolveDeletedTabItemGroupId(db, userId, entityId, payload.group_id)
    await db
      .prepare(
        `DELETE FROM tab_group_items
         WHERE id = ? AND group_id IN (SELECT id FROM tab_groups WHERE user_id = ?)`
      )
      .bind(entityId, userId)
      .run()
    if (groupId) {
      await db
        .prepare('UPDATE tab_groups SET updated_at = ? WHERE id = ? AND user_id = ?')
        .bind(now, groupId, userId)
        .run()
    }
    await recordEntityRevision(db, userId, 'tab_group_item', entityId, revision, now)
    return { ok: true }
  }

  // Guard cross-user IDOR on the item id: an existing id must be reachable
  // through a group owned by this user. The caller's own items proceed to the
  // ON CONFLICT(id) update path below — client edits to existing items must
  // not be silently dropped.
  const ownedExisting = await db
    .prepare(
      `SELECT tgi.id
       FROM tab_group_items tgi
       JOIN tab_groups tg ON tg.id = tgi.group_id
       WHERE tgi.id = ? AND tg.user_id = ?`
    )
    .bind(entityId, userId)
    .first<{ id: string }>()
  if (!ownedExisting) {
    const foreign = await db
      .prepare('SELECT id FROM tab_group_items WHERE id = ?')
      .bind(entityId)
      .first<{ id: string }>()
    if (foreign) return { ok: false, reason: 'The entity id belongs to a different account.' }
  }
  const owningGroup = await db
    .prepare('SELECT id FROM tab_groups WHERE id = ? AND user_id = ?')
    .bind(payload.group_id, userId)
    .first<{ id: string }>()
  if (!owningGroup) {
    return { ok: false, reason: 'The parent tab group was not found for this account.' }
  }

  await db
    .prepare(
      `INSERT INTO tab_group_items
       (id, group_id, title, url, favicon, position, is_pinned, is_todo, is_archived, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id)
       DO UPDATE SET
         group_id = excluded.group_id,
         title = excluded.title,
         url = excluded.url,
         favicon = excluded.favicon,
         position = excluded.position,
         is_pinned = excluded.is_pinned,
         is_todo = excluded.is_todo,
         is_archived = excluded.is_archived`
    )
    .bind(
      entityId,
      payload.group_id,
      sanitizeString(payload.title ?? '', 500),
      sanitizeUrl(payload.url ?? ''),
      typeof payload.favicon === 'string' ? sanitizeString(payload.favicon, 2000) : null,
      payload.position ?? 0,
      toBooleanInt(payload.is_pinned),
      toBooleanInt(payload.is_todo),
      toBooleanInt(payload.is_archived),
      now
    )
    .run()
  await db
    .prepare('UPDATE tab_groups SET updated_at = ? WHERE id = ? AND user_id = ?')
    .bind(now, payload.group_id, userId)
    .run()
  await recordEntityRevision(db, userId, 'tab_group_item', entityId, revision, now)
  return { ok: true }
}

export async function validateTabGroupItemPayload(
  db: D1Database,
  userId: string,
  payload: TabGroupItemSyncPayload,
  operation: SyncOperationType
): Promise<string | null> {
  if (operation === 'delete') return null
  if (!payload || typeof payload.group_id !== 'string' || payload.group_id.trim() === '') {
    return 'Tab group item group_id is required.'
  }
  if (typeof payload.title !== 'string' || payload.title.trim() === '') {
    return 'Tab group item title is required.'
  }
  if (typeof payload.url !== 'string' || payload.url.trim() === '') {
    return 'Tab group item URL is required.'
  }
  try {
    const url = new URL(payload.url)
    if (!['http:', 'https:'].includes(url.protocol)) {
      return 'Only http and https URLs can be synced.'
    }
  } catch {
    return 'Tab group item URL is invalid.'
  }

  const group = await db
    .prepare('SELECT id, is_locked FROM tab_groups WHERE id = ? AND user_id = ? AND is_deleted = 0')
    .bind(payload.group_id, userId)
    .first<{ id: string; is_locked: number }>()
  if (!group) {
    return 'Tab group item parent group was not found.'
  }
  // R8 BR-3/CA-2: item pushes into a web-locked group are terminal rejections
  // (VALIDATION_FAILED at the envelope level) instead of silently mutating a
  // group the web UI promised was frozen.
  if (group.is_locked) {
    return 'Tab group is locked.'
  }
  return null
}

async function resolveDeletedTabItemGroupId(
  db: D1Database,
  userId: string,
  itemId: string,
  payloadGroupId?: string
): Promise<string | null> {
  if (payloadGroupId) return payloadGroupId
  const row = await db
    .prepare(
      `SELECT tgi.group_id
       FROM tab_group_items tgi
       JOIN tab_groups tg ON tg.id = tgi.group_id
       WHERE tgi.id = ? AND tg.user_id = ?`
    )
    .bind(itemId, userId)
    .first<{ group_id: string }>()
  return row?.group_id ?? null
}
