import type { SyncEntityType, SyncOperationType } from '@tmarks/contracts'

/** Outcome of applying one sync operation: applied, or skipped with a reason. */
export interface SyncApplyResult {
  ok: boolean
  /** Post-mutation payload in loadServerPayload's shape (skips its read-back). */
  payload?: unknown
  reason?: string
  /**
   * Rejection code surfaced to the client; defaults to OWNERSHIP_CONFLICT.
   * Codes the client treats as terminal stop the retry loop, so an operation
   * that can never apply cannot wedge the push queue behind it.
   */
  code?: string
}

export interface SyncChangeRow {
  id: number
  change_id: string
  entity_type: SyncEntityType
  entity_id: string
  operation: SyncOperationType
  revision: string
  payload_json: string | null
  changed_at: string
}

export interface BookmarkSyncPayload {
  title?: string
  url?: string
  description?: string | null
  folder_id?: string | null
  favicon?: string | null
  cover_image?: string | null
  is_pinned?: boolean | number
  pin_order?: number | null
  is_todo?: boolean | number
  is_archived?: boolean | number
  is_private?: boolean | number
  position?: number
  tag_ids?: string[]
  tag_names?: string[]
}

export interface BookmarkFolderSyncPayload {
  name?: string
  parent_id?: string | null
  position?: number
}

export interface TagSyncPayload {
  name?: string
  color?: string | null
}

export interface TabGroupSyncPayload {
  title?: string
  parent_id?: string | null
  is_folder?: boolean | number
  position?: number
  color?: string | null
  tags?: string[]
  tabs?: Array<{
    id?: string
    title: string
    url: string
    favicon?: string | null
    position?: number
    is_pinned?: boolean | number
    is_todo?: boolean | number
    is_archived?: boolean | number
  }>
}

export interface TabGroupItemSyncPayload {
  group_id?: string
  title?: string
  url?: string
  favicon?: string | null
  position?: number
  is_pinned?: boolean | number
  is_todo?: boolean | number
  is_archived?: boolean | number
}

export type PreferenceSyncPayload = Record<string, unknown>

export interface SyncEntityRow {
  id: string
  revision: string | null
  deleted_at?: string | null
  is_deleted?: number | null
}

export interface SyncEntityRevisionRow {
  user_id: string
  entity_type: SyncEntityType
  entity_id: string
  revision: string
  updated_at: string
}

export interface StoredIdempotencyRow {
  request_hash: string
  response_json: string
}
