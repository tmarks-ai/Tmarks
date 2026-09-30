import type { SyncOperationType } from '@tmarks/contracts'
import type { SyncApplyResult, PreferenceSyncPayload, TagSyncPayload } from './sync-types'
import { recordEntityRevision } from './sync-repository'
import { clampText, normalizePreferencePayload } from './sync-utils'
import { sanitizeColor } from '../validation'

export async function applyTagOperation(
  db: D1Database,
  userId: string,
  entityId: string,
  revision: string,
  now: string,
  payload: TagSyncPayload,
  operation: SyncOperationType
): Promise<SyncApplyResult> {
  if (operation === 'delete') {
    await db
      .prepare('UPDATE tags SET deleted_at = ?, updated_at = ? WHERE id = ? AND user_id = ?')
      .bind(now, now, entityId, userId)
      .run()
    await recordEntityRevision(db, userId, 'tag', entityId, revision, now)
    return { ok: true }
  }

  // Guard cross-user IDOR on the tag primary key.
  const owner = await db
    .prepare('SELECT user_id FROM tags WHERE id = ?')
    .bind(entityId)
    .first<{ user_id: string }>()
  if (owner && owner.user_id !== userId) {
    return { ok: false, reason: 'The entity id belongs to a different account.' }
  }

  // REST 同口径:标签名 50(POST /tags 的 sanitizeString(body.name, 50)、书签面
  // normalizeTagNames 的 slice(0, 50))。同步面此前绕过该上限:51-64 字符名
  // (validateTagPayload 只拒 >64)在此全长落库,而 REST 书签面按 50 截断解析时
  // 会 miss 掉这行、另建一行 50 字符的近重复标签。截断必须先于撞名检测,否则
  // 超长名与它的 50 前缀会被当成两个名字放行。
  // (分发层 validateTagPayload 已拒空名,此处护栏仅供 applyTagOperation 被直接
  // 调用时兜底,与目录面 clampText(name, 120) 的 validate-then-clamp 模式对齐。)
  const name = clampText(payload.name, 50)
  if (!name) {
    return { ok: false, code: 'VALIDATION_FAILED', reason: 'Tag name is required.' }
  }

  // Keying the upsert on (user_id, name) rewrote whichever row happened to hold
  // the target name, so renaming a tag onto an existing name clobbered that
  // other tag and recorded the revision against the wrong id. Key on `id` and
  // reject the collision explicitly instead.
  const duplicate = await db
    .prepare('SELECT id FROM tags WHERE user_id = ? AND name = ? AND id != ? LIMIT 1')
    .bind(userId, name, entityId)
    .first<{ id: string }>()
  if (duplicate) {
    return {
      ok: false,
      code: 'TAG_EXISTS',
      reason: 'Another tag in this account already uses this name.',
    }
  }

  await db
    .prepare(
      `INSERT INTO tags
       (id, user_id, name, color, click_count, created_at, updated_at, deleted_at)
       VALUES (?, ?, ?, ?, 0, ?, ?, NULL)
       ON CONFLICT(id)
       DO UPDATE SET
         name = excluded.name,
         color = excluded.color,
         updated_at = excluded.updated_at,
         deleted_at = NULL`
    )
    .bind(entityId, userId, name, payload.color ? sanitizeColor(payload.color) : null, now, now)
    .run()
  await recordEntityRevision(db, userId, 'tag', entityId, revision, now)
  return { ok: true }
}

export async function applyPreferenceOperation(
  db: D1Database,
  userId: string,
  revision: string,
  now: string,
  payload: PreferenceSyncPayload
): Promise<SyncApplyResult> {
  const allowed = normalizePreferencePayload(payload)
  await db
    .prepare(
      `INSERT INTO user_preferences (user_id, updated_at)
       VALUES (?, ?)
       ON CONFLICT(user_id) DO NOTHING`
    )
    .bind(userId, now)
    .run()

  const keys = Object.keys(allowed)
  if (keys.length > 0) {
    await db
      .prepare(
        `UPDATE user_preferences
         SET ${keys.map((key) => `${key} = ?`).join(', ')}, updated_at = ?
         WHERE user_id = ?`
      )
      .bind(...keys.map((key) => allowed[key]), now, userId)
      .run()
  }

  await recordEntityRevision(db, userId, 'preference', 'preferences', revision, now)
  return { ok: true }
}