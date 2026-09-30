import type { Table } from 'dexie'
import type { SyncOperationType } from '@tmarks/contracts'
import type { SyncStateRecord } from './index'

const SYNC_OPERATIONS = new Set<SyncOperationType>(['upsert', 'delete', 'restore'])
const SYNC_MODES = new Set<SyncStateRecord['mode']>(['local_only', 'cloud_sync', 'paused'])

export const BOOKMARK_SYNC_FIELDS = ['title', 'url', 'description', 'cover_image', 'favicon', 'folder_id', 'is_pinned', 'is_archived', 'is_todo', 'is_private', 'position', 'tags', 'deleted_at']
export const FOLDER_SYNC_FIELDS = ['name', 'parent_id', 'position', 'deleted_at']
export const TAG_SYNC_FIELDS = ['name', 'color', 'deleted_at']
export const TAB_GROUP_SYNC_FIELDS = ['title', 'color', 'tags', 'parent_id', 'is_folder', 'position', 'item_count', 'deleted_at']
export const TAB_GROUP_ITEM_SYNC_FIELDS = ['group_id', 'title', 'url', 'favicon', 'position', 'is_pinned', 'is_todo', 'is_archived']

export async function migrateSyncEntities(table: Table<Record<string, unknown>, string>, fields: string[]): Promise<void> {
  await table.toCollection().modify((row) => {
    const legacyDirty = row.dirty === true
    const dirtyFields = Array.isArray(row.dirty_fields)
      ? row.dirty_fields.filter((field): field is string => typeof field === 'string' && fields.includes(field))
      : legacyDirty
        ? [...fields]
        : []
    const deleted = typeof row.deleted_at === 'string' && row.deleted_at.length > 0
    const pendingOp = SYNC_OPERATIONS.has(row.pending_op as SyncOperationType)
      ? row.pending_op as SyncOperationType
      : deleted
        ? 'delete'
        : dirtyFields.length > 0
          ? 'upsert'
          : null

    row.base_revision = typeof row.base_revision === 'string'
      ? row.base_revision
      : typeof row.revision === 'string'
        ? row.revision
        : null
    row.dirty_fields = deleted && dirtyFields.length === 0 ? ['deleted_at'] : dirtyFields
    row.pending_op = pendingOp
    delete row.dirty
  })
}

export function isSyncMode(value: unknown): value is SyncStateRecord['mode'] {
  return typeof value === 'string' && SYNC_MODES.has(value as SyncStateRecord['mode'])
}
