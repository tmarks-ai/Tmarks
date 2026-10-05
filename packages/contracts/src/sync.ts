import type { DeviceId, EntityId, ISODateTimeString, Revision, SyncCursor } from './primitives'

export type SyncEntityType =
  | 'bookmark'
  | 'bookmark_folder'
  | 'tag'
  | 'tab_group'
  | 'tab_group_item'
  | 'preference'

export type SyncOperationType = 'upsert' | 'delete' | 'restore'

export interface SyncEnvelope<TPayload = unknown> {
  client_operation_id: string
  device_id: DeviceId
  entity_type: SyncEntityType
  entity_id: EntityId
  operation: SyncOperationType
  base_revision: Revision | null
  payload: TPayload
  created_at: ISODateTimeString
}

export interface SyncChange<TPayload = unknown> {
  change_id: string
  cursor: SyncCursor
  entity_type: SyncEntityType
  entity_id: EntityId
  operation: SyncOperationType
  /**
   * Null on bootstrap rows that predate revision tracking (folders, tags and
   * tab-group items carry no revision column) — clients treat null as
   * last-write-wins, the same semantic as server_revision in SyncConflict
   * (R8 BL-3). Incremental changes always carry a real revision.
   */
  revision: Revision | null
  payload: TPayload
  changed_at: ISODateTimeString
}

export interface SyncStateDTO {
  cursor: SyncCursor | null
  last_successful_sync_at: ISODateTimeString | null
  mode: 'local_only' | 'cloud_sync' | 'paused'
}

export interface SyncBootstrapResponse {
  cursor: SyncCursor
  server_time: ISODateTimeString
  /**
   * Bootstrap is paged; a full-state snapshot in one response was unbounded and
   * grew with the account. Loop until has_more is false, then reconcile.
   * Absent on responses from a server predating pagination (treat as complete).
   */
  has_more?: boolean
  /** Opaque token for the next page; null on the final page. */
  page_cursor?: string | null
  entities: {
    bookmarks: SyncChange[]
    bookmark_folders: SyncChange[]
    tags: SyncChange[]
    tab_groups: SyncChange[]
    tab_group_items: SyncChange[]
    preferences: SyncChange[]
  }
}

export interface SyncChangesResponse {
  cursor: SyncCursor
  has_more: boolean
  changes: SyncChange[]
}

export interface SyncPushRequest {
  device_id: DeviceId
  operations: SyncEnvelope[]
}

export interface SyncAcceptedOperation {
  client_operation_id: string
  entity_id: EntityId
  revision: Revision
}

export interface SyncRejectedOperation {
  client_operation_id: string
  entity_type: SyncEntityType
  entity_id: EntityId
  code: string
  message: string
  /**
   * Present on invariant rejections (e.g. INVALID_PARENT_TREE): the server's
   * current state in loadServerPayload's shape, so the client can offer an
   * accept-remote resolution for operations that can never re-apply as-is.
   */
  server_payload?: unknown
  /** Revision of the server row the payload was read from, when present. */
  server_revision?: Revision | null
}

export interface SyncConflictDTO {
  client_operation_id: string
  entity_type: SyncEntityType
  entity_id: EntityId
  local_payload: unknown
  server_payload: unknown
  /** Null when the server row predates revision tracking or was hard-deleted. */
  server_revision: Revision | null
  // R8 CA-8: 'permission_denied' removed — it had zero producers and zero
  // consumers; the only conflict reasons the server emits are the two below.
  reason: 'revision_mismatch' | 'deleted_on_server'
}

export interface SyncPushResponse {
  accepted: SyncAcceptedOperation[]
  conflicts: SyncConflictDTO[]
  rejected: SyncRejectedOperation[]
  cursor: SyncCursor
}
