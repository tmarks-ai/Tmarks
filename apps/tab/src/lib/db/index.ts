import Dexie, { type Table } from 'dexie'
import type {
  BookmarkDTO,
  BookmarkFolderDTO,
  DeviceId,
  EntityId,
  Revision,
  SyncCursor,
  SyncOperationType,
  SyncStateDTO,
  TabGroupDTO,
  TabGroupItemDTO,
  TagDTO,
} from '@tmarks/contracts'
import {
  BOOKMARK_SYNC_FIELDS,
  FOLDER_SYNC_FIELDS,
  TAG_SYNC_FIELDS,
  TAB_GROUP_SYNC_FIELDS,
  TAB_GROUP_ITEM_SYNC_FIELDS,
  migrateSyncEntities,
  isSyncMode,
} from './migration-helpers'

interface SyncFields {
  base_revision: Revision | null
  dirty_fields: string[]
  pending_op: SyncOperationType | null
}

export type LocalBookmark = BookmarkDTO & SyncFields
export type LocalTabGroup = TabGroupDTO & SyncFields
export type LocalTabGroupItem = TabGroupItemDTO & SyncFields
export type LocalFolder = BookmarkFolderDTO & SyncFields
export type LocalTag = TagDTO & SyncFields

/**
 * `exhausted` is terminal: takePendingBatch skips it, so an operation the server
 * can never accept stops retrying instead of blocking every later push behind
 * it. The row is kept so the user can inspect and retry it from the options page.
 */
type SyncQueueStatus = 'pending' | 'syncing' | 'synced' | 'failed' | 'conflict' | 'exhausted'

export interface SyncQueueRecord {
  id: string
  client_operation_id: string
  device_id: DeviceId
  entity_type: 'tab_group' | 'tab_group_item' | 'bookmark' | 'bookmark_folder' | 'tag'
  entity_id: EntityId
  operation: SyncOperationType
  base_revision: Revision | null
  payload: unknown
  dirty_fields: string[]
  sync_generation: number
  server_payload?: unknown
  server_revision?: Revision | null
  status: SyncQueueStatus
  retry_count: number
  next_retry_at: string | null
  error_code: string | null
  error_message: string | null
  created_at: string
  updated_at: string
}

export type OperationLogStatus = 'ok' | 'failed' | 'conflict'

export interface OperationLogRecord {
  id: string
  created_at: string
  entity_type: 'tab_group' | 'tab_group_item' | 'bookmark' | 'bookmark_folder' | 'tag'
  entity_id: EntityId
  operation: SyncOperationType
  status: OperationLogStatus
  detail: string | null
}

interface DeviceMeta {
  id: 'singleton'
  device_id: DeviceId
  created_at: string
}

export interface SyncStateRecord {
  id: 'singleton'
  cursor: SyncCursor | null
  last_sync_at: string | null
  last_bootstrap_at: string | null
  mode: SyncStateDTO['mode']
}

/** 快照上传缓冲:本地优先保存(create 即写),异步排队上传 R2;成功删行,失败退避重试。 */
type SnapshotUploadStatus = 'pending' | 'uploading' | 'failed' | 'exhausted'

export interface SnapshotUploadRecord {
  id: string
  bookmark_id: EntityId
  title: string
  url: string
  html_content: string
  status: SnapshotUploadStatus
  retry_count: number
  next_retry_at: string | null
  error_code: string | null
  error_message: string | null
  created_at: string
  updated_at: string
}

export class TMarkDB extends Dexie {
  bookmarks!: Table<LocalBookmark, string>
  folders!: Table<LocalFolder, string>
  tags!: Table<LocalTag, string>
  tabGroups!: Table<LocalTabGroup, string>
  tabGroupItems!: Table<LocalTabGroupItem, string>
  meta!: Table<DeviceMeta, string>
  syncState!: Table<SyncStateRecord, string>
  syncQueue!: Table<SyncQueueRecord, string>
  operationLogs!: Table<OperationLogRecord, string>
  snapshotUploads!: Table<SnapshotUploadRecord, string>

  constructor(name = 'tmark') {
    super(name)
    this.version(1).stores({
      bookmarks: 'id, folder_id',
      tabGroups: 'id, parent_id',
      tabGroupItems: 'id, group_id',
      meta: 'id',
      syncState: 'id',
    })
    this.version(2).stores({
      bookmarks: 'id, folder_id',
      tabGroups: 'id, parent_id',
      tabGroupItems: 'id, group_id',
      meta: 'id',
      syncState: 'id',
      snapshotQueue: 'id, created_at',
    })
    this.version(3).stores({
      bookmarks: 'id, folder_id, url',
      tabGroups: 'id, parent_id',
      tabGroupItems: 'id, group_id',
      meta: 'id',
      syncState: 'id',
      snapshotQueue: 'id, created_at',
    })
    this.version(4).stores({
      bookmarks: 'id, folder_id, url',
      tabGroups: 'id, parent_id',
      tabGroupItems: 'id, group_id, url',
      meta: 'id',
      syncState: 'id',
      snapshotQueue: 'id, created_at',
    })
    this.version(5).stores({
      bookmarks: 'id, folder_id, url',
      folders: 'id, parent_id',
      tags: 'id, name',
      tabGroups: 'id, parent_id',
      tabGroupItems: 'id, group_id, url',
      meta: 'id',
      syncState: 'id',
      snapshotQueue: 'id, created_at',
    })
    this.version(6).stores({
      bookmarks: 'id, folder_id, url',
      folders: 'id, parent_id',
      tags: 'id, name',
      tabGroups: 'id, parent_id',
      tabGroupItems: 'id, group_id, url',
      meta: 'id',
      syncState: 'id',
      snapshotQueue: 'id, created_at',
      syncQueue: 'id, [entity_type+entity_id+operation], entity_type, entity_id, status, next_retry_at, created_at',
      operationLogs: 'id, created_at, entity_type, entity_id, status',
    }).upgrade(async (tx) => {
      await Promise.all([
        migrateSyncEntities(tx.table('bookmarks'), BOOKMARK_SYNC_FIELDS),
        migrateSyncEntities(tx.table('folders'), FOLDER_SYNC_FIELDS),
        migrateSyncEntities(tx.table('tags'), TAG_SYNC_FIELDS),
        migrateSyncEntities(tx.table('tabGroups'), TAB_GROUP_SYNC_FIELDS),
        migrateSyncEntities(tx.table('tabGroupItems'), TAB_GROUP_ITEM_SYNC_FIELDS),
      ])

      const state = await tx.table('syncState').get('singleton') as Partial<SyncStateRecord> | undefined
      await tx.table('syncState').put({
        ...DEFAULT_SYNC_STATE,
        ...state,
        id: 'singleton',
        cursor: typeof state?.cursor === 'string' ? state.cursor : null,
        last_sync_at: typeof state?.last_sync_at === 'string' ? state.last_sync_at : null,
        last_bootstrap_at: typeof state?.last_bootstrap_at === 'string' ? state.last_bootstrap_at : null,
        mode: isSyncMode(state?.mode) ? state.mode : DEFAULT_SYNC_STATE.mode,
      })
    })
    this.version(7).stores({
      bookmarks: 'id, folder_id, url',
      folders: 'id, parent_id',
      tags: 'id, name',
      tabGroups: 'id, parent_id',
      tabGroupItems: 'id, group_id, url',
      meta: 'id',
      syncState: 'id',
      snapshotQueue: null,
      syncQueue: 'id, [entity_type+entity_id+operation], entity_type, entity_id, status, next_retry_at, created_at',
      operationLogs: 'id, created_at, entity_type, entity_id, status',
    })
    this.version(8).stores({
      // 快照上传缓冲区(本地优先):create 即写本地,异步排队上传 R2。与 v7 撤掉的
      // snapshotQueue 同名不同命(snapshotQueue 已 null,此处不复活旧表)。
      snapshotUploads: 'id, bookmark_id, status, next_retry_at, created_at',
    })
    this.version(9).stores({
      // folders 缺 name 索引,而 ensureBookmarkFolderPath 用 where('name') 按
      // 名称复用目录 —— AI 目录建议的保存路径会在没有该索引时直接抛
      // SchemaError。纯增量迁移:只为现有数据补建索引。
      folders: 'id, parent_id, name',
    })
    this.version(10).stores({
      // AI taxonomy sampling uses bounded ordered reads instead of loading the
      // entire tag table for every classification request.
      tags: 'id, name, bookmark_count, click_count, updated_at',
    })
  }
}

export const db = new TMarkDB()

/** acceptRemoteSyncQueueItem 级联写覆盖的表(事务范围)。每新增跨表原子写需同步加入。 */
export const ACCEPT_REMOTE_TRANSACTION_TABLES = [
  db.bookmarks,
  db.folders,
  db.tags,
  db.tabGroups,
  db.tabGroupItems,
  db.operationLogs,
  db.syncQueue,
  db.syncState,
] as const

// sync 状态的默认值:v6 升级与 getSyncState 共用(getSyncState 在 ./sync-state)。
export const DEFAULT_SYNC_STATE: SyncStateRecord = {
  id: 'singleton',
  cursor: null,
  last_sync_at: null,
  last_bootstrap_at: null,
  mode: 'local_only',
}
