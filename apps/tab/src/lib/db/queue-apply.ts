import type { EntityId, Revision, SyncConflictDTO, SyncPushResponse, SyncRejectedOperation } from '@tmarks/contracts'
import { db, type SyncQueueRecord } from './index'
import { rebaseEntityRevision } from './queue-rebase'
import { isNonBurningSyncErrorCode, isTerminalSyncRejectCode } from './queue-errors'
import { MAX_SYNC_RETRIES, nextRetryAt, isCurrentQueueSnapshot, getEntityDirtyFields, type SyncEntityType } from './queue'

/**
 * 应用 push 响应(自 queue.ts 拆出以守住 300 行门禁):accepted→删除队列项 +
 * 清实体 dirty_fields;rejected→failed+退避;conflict→conflict 标记。
 */
export async function applyPushResponse(items: SyncQueueRecord[], response: SyncPushResponse): Promise<{ accepted: number; conflicts: number; rejected: number }> {
  const byClient = new Map(items.map((r) => [r.client_operation_id, r]))
  const ts = new Date().toISOString()
  let accepted = 0, conflicts = 0, rejected = 0

  await db.transaction('rw', [db.syncQueue, db.bookmarks, db.folders, db.tags, db.tabGroups, db.tabGroupItems], async () => {
    for (const a of response.accepted as SyncPushResponse['accepted']) {
      const item = byClient.get(a.client_operation_id)
      if (!item || !(await isCurrentQueueSnapshot(item))) continue
      if (!(await clearEntityDirtyFields(item.entity_type, item.entity_id, a.entity_id, a.revision as Revision, item))) continue
      await db.syncQueue.delete(item.id)
      accepted++
    }
    for (const r of response.rejected as SyncRejectedOperation[]) {
      const item = byClient.get(r.client_operation_id)
      if (!item || !(await isCurrentQueueSnapshot(item))) continue
      // R5-10: non-burning codes (RATE_LIMITED / IDEMPOTENCY_IN_PROGRESS / …)
      // arrive INSIDE a 200 push body on this very loop, which previously
      // burned one retry per collision — after MAX_SYNC_RETRIES the op
      // dead-lettered as 'exhausted' in exactly the engineered scenario
      // (re-pushing a placeholder another push had claimed). Apply markFailed's
      // non-burning semantics: keep retry_count, clear the backoff, stay
      // 'failed' so the drain re-picks the row soon.
      if (isNonBurningSyncErrorCode(r.code)) {
        await db.syncQueue.update(item.id, {
          status: 'failed',
          retry_count: item.retry_count,
          next_retry_at: null,
          error_code: r.code,
          error_message: r.message,
          server_payload: null,
          server_revision: null,
          updated_at: ts,
        })
        rejected++
        continue
      }
      const retryCount = item.retry_count + 1
      // Terminal codes can never succeed: stop immediately instead of burning the retry budget.
      const exhausted = isTerminalSyncRejectCode(r.code) || retryCount >= MAX_SYNC_RETRIES
      await db.syncQueue.update(item.id, {
        status: exhausted ? 'exhausted' : 'failed',
        retry_count: retryCount,
        next_retry_at: exhausted ? null : nextRetryAt(retryCount),
        error_code: r.code,
        error_message: r.message,
        // 不变量拒绝(如 INVALID_PARENT_TREE)附带服务器状态 → 审查区可"接受远端"。
        ...(r.server_payload != null && {
          server_payload: r.server_payload,
          server_revision: r.server_revision ?? null,
        }),
        updated_at: ts,
      })
      rejected++
    }
    for (const c of response.conflicts as SyncConflictDTO[]) {
      const item = byClient.get(c.client_operation_id)
      if (!item || !(await isCurrentQueueSnapshot(item))) continue
      await db.syncQueue.update(item.id, {
        status: 'conflict',
        error_code: 'CONFLICT',
        error_message: c.reason,
        server_payload: c.server_payload,
        server_revision: c.server_revision,
        updated_at: ts,
      })
      conflicts++
    }
  })
  return { accepted, conflicts, rejected }
}

async function clearEntityDirtyFields(entityType: SyncEntityType, entityId: EntityId, serverEntityId: EntityId | undefined, revision: Revision, snapshot: SyncQueueRecord): Promise<boolean> {
  const currentDirtyFields = await getEntityDirtyFields(entityType, entityId)
  if (JSON.stringify(currentDirtyFields) !== JSON.stringify(snapshot.dirty_fields)) {
    // 在途编辑:op1 被接受后用户又改了同一实体。不 rebase 的话后续 op 仍带旧
    // base_revision 推送 → 必然 revision_mismatch 进复核;payload 是全量快照,重置 base_revision 即可重推安全。
    await rebaseEntityRevision(entityType, entityId, revision)
    return false
  }

  if (serverEntityId && serverEntityId !== entityId) {
    // entity_id 替换(tag dedup-by-name)→ 删本地临时行,pull 带回规范 id。
    await deleteEntityRow(entityType, entityId)
    return true
  }
  if (snapshot.operation === 'delete') {
    // delete 已被服务端确认 → 本地硬删(软清会短暂复活直到下次 pull;直接硬删更一致)。
    await deleteEntityRow(entityType, entityId)
    return true
  }
  if (entityType === 'tab_group') {
    await db.tabGroups.update(entityId, { base_revision: revision, dirty_fields: [], pending_op: null, deleted_at: null })
  } else if (entityType === 'tab_group_item') {
    await db.tabGroupItems.update(entityId, { base_revision: revision, dirty_fields: [], pending_op: null })
  } else if (entityType === 'bookmark') {
    await db.bookmarks.update(entityId, { base_revision: revision, dirty_fields: [], pending_op: null, deleted_at: null })
  } else if (entityType === 'bookmark_folder') {
    // folder.children 自引用触发 Dexie KeyPaths 循环 → get+put 绕过 update。
    const f = await db.folders.get(entityId)
    if (f) await db.folders.put({ ...f, base_revision: revision, dirty_fields: [], pending_op: null, deleted_at: null })
  } else {
    await db.tags.update(entityId, { base_revision: revision, dirty_fields: [], pending_op: null })
  }
  return true
}

async function deleteEntityRow(entityType: SyncEntityType, entityId: EntityId): Promise<void> {
  if (entityType === 'tab_group') await db.tabGroups.delete(entityId)
  else if (entityType === 'tab_group_item') await db.tabGroupItems.delete(entityId)
  else if (entityType === 'bookmark') await db.bookmarks.delete(entityId)
  else if (entityType === 'bookmark_folder') await db.folders.delete(entityId)
  else await db.tags.delete(entityId)
}
