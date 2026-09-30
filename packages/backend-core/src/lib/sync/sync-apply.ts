import type {
  SyncAcceptedOperation,
  SyncConflictDTO,
  SyncEnvelope,
  SyncRejectedOperation,
} from '@tmarks/contracts'
import type {
  BookmarkFolderSyncPayload,
  BookmarkSyncPayload,
  PreferenceSyncPayload,
  TabGroupItemSyncPayload,
  TabGroupSyncPayload,
  TagSyncPayload,
} from './sync-types'
import { getExistingEntity, loadServerPayload, recordSyncChange } from './sync-repository'
import {
  applyBookmarkFolderOperation,
  applyBookmarkOperation,
  applyPreferenceOperation,
  applyTabGroupItemOperation,
  applyTabGroupOperation,
  applyTagOperation,
  validateTabGroupItemPayload,
} from './sync-operations'
import {
  createRevision,
  isEntityDeleted,
  isSupportedEntity,
  isSupportedOperation,
  reject,
  validateBookmarkFolderPayload,
  validateBookmarkPayload,
  validateTabGroupPayload,
  validateTagPayload,
} from './sync-utils'
import { isResurrectingDeletedEntity } from './sync-recovery'

/**
 * 单条同步操作的应用分发(自 sync.ts 拆出,无行为变化):实体/操作支持性、
 * 幂等与复活检查、revision 冲突、逐实体验证与落地、变更记录。
 */
export async function applySyncOperation(
  db: D1Database,
  userId: string,
  deviceId: string,
  operation: SyncEnvelope
): Promise<
  | { type: 'accepted'; value: SyncAcceptedOperation }
  | { type: 'conflict'; value: SyncConflictDTO }
  | { type: 'rejected'; value: SyncRejectedOperation }
> {
  if (!isSupportedEntity(operation.entity_type)) {
    return { type: 'rejected', value: reject(operation, 'UNSUPPORTED_ENTITY', 'This entity is not supported by sync v1 yet.') }
  }

  if (!isSupportedOperation(operation.operation)) {
    return { type: 'rejected', value: reject(operation, 'UNSUPPORTED_OPERATION', 'This operation is not supported by sync v1 yet.') }
  }

  const existing = await getExistingEntity(db, userId, operation)

  const revisionMismatch = Boolean(
    existing && operation.base_revision && existing.revision && operation.base_revision !== existing.revision
  )
  const resurrects = isResurrectingDeletedEntity(operation, existing, existing ? isEntityDeleted(existing) : false)

  if (existing && (revisionMismatch || resurrects)) {
    return {
      type: 'conflict',
      value: {
        client_operation_id: operation.client_operation_id,
        entity_type: operation.entity_type,
        entity_id: operation.entity_id,
        local_payload: operation.payload,
        server_payload: await loadServerPayload(db, userId, operation.entity_type, existing.id),
        server_revision: existing.revision,
        reason: isEntityDeleted(existing) ? 'deleted_on_server' : 'revision_mismatch',
      },
    }
  }

  const entityId = existing?.id ?? operation.entity_id
  const revision = createRevision()
  const now = new Date().toISOString()

  const ownershipRejected = (outcome: { reason?: string; code?: string; payload?: unknown }) => {
    const value = reject(
      operation,
      outcome.code ?? 'OWNERSHIP_CONFLICT',
      outcome.reason ?? 'The operation was rejected.'
    )
    // Invariant rejections (e.g. a tab-group cycle that can never re-apply)
    // carry the server's current state so the client can offer accept-remote.
    if (outcome.payload !== undefined) {
      value.server_payload = outcome.payload
      value.server_revision = existing?.revision ?? null
    }
    return { type: 'rejected' as const, value }
  }

  // Skips recordSyncChange's 2-query payload read-back for bookmark ops.
  let bookmarkPayload: unknown
  if (operation.entity_type === 'bookmark') {
    const payload = operation.payload as BookmarkSyncPayload
    const validationError = validateBookmarkPayload(payload, operation.operation)
    if (validationError) {
      return { type: 'rejected', value: reject(operation, 'VALIDATION_FAILED', validationError) }
    }
    const outcome = await applyBookmarkOperation(db, userId, entityId, revision, now, payload, operation.operation)
    if (!outcome.ok) return ownershipRejected(outcome)
    bookmarkPayload = outcome.payload
  }

  if (operation.entity_type === 'bookmark_folder') {
    const payload = operation.payload as BookmarkFolderSyncPayload
    const validationError = validateBookmarkFolderPayload(payload, operation.operation)
    if (validationError) {
      return { type: 'rejected', value: reject(operation, 'VALIDATION_FAILED', validationError) }
    }
    const outcome = await applyBookmarkFolderOperation(db, userId, entityId, revision, now, payload, operation.operation)
    if (!outcome.ok) return ownershipRejected(outcome)
  }

  if (operation.entity_type === 'tag') {
    const payload = operation.payload as TagSyncPayload
    const validationError = validateTagPayload(payload, operation.operation)
    if (validationError) {
      return { type: 'rejected', value: reject(operation, 'VALIDATION_FAILED', validationError) }
    }
    const outcome = await applyTagOperation(db, userId, entityId, revision, now, payload, operation.operation)
    if (!outcome.ok) return ownershipRejected(outcome)
  }

  if (operation.entity_type === 'tab_group') {
    const payload = operation.payload as TabGroupSyncPayload
    const validationError = validateTabGroupPayload(payload, operation.operation)
    if (validationError) {
      return { type: 'rejected', value: reject(operation, 'VALIDATION_FAILED', validationError) }
    }
    const outcome = await applyTabGroupOperation(db, userId, entityId, revision, now, payload, operation.operation)
    if (!outcome.ok) return ownershipRejected(outcome)
  }

  if (operation.entity_type === 'tab_group_item') {
    const payload = operation.payload as TabGroupItemSyncPayload
    const validationError = await validateTabGroupItemPayload(db, userId, payload, operation.operation)
    if (validationError) {
      return { type: 'rejected', value: reject(operation, 'VALIDATION_FAILED', validationError) }
    }
    const outcome = await applyTabGroupItemOperation(db, userId, entityId, revision, now, payload, operation.operation)
    if (!outcome.ok) return ownershipRejected(outcome)
  }

  if (operation.entity_type === 'preference') {
    const payload = operation.payload as PreferenceSyncPayload
    await applyPreferenceOperation(db, userId, revision, now, payload)
  }

  await recordSyncChange(db, userId, deviceId, operation.entity_type, entityId, operation.operation, revision, bookmarkPayload)

  return {
    type: 'accepted',
    value: {
      client_operation_id: operation.client_operation_id,
      entity_id: entityId,
      revision,
    },
  }
}
