import type { SyncEntityType, SyncOperationType } from '@tmarks/contracts'

export interface SyncBookmarkRow {
  id: string
  user_id: string
  title: string
  url: string
  normalized_url: string | null
  description: string | null
  folder_id: string | null
  cover_image: string | null
  favicon: string | null
  is_pinned: number
  pin_order: number
  click_count: number
  last_clicked_at: string | null
  revision: string | null
  created_at: string
  updated_at: string
  deleted_at: string | null
}

export interface SyncTagRow {
  id: string
  user_id: string
  name: string
  color: string | null
  click_count: number
  last_clicked_at: string | null
  created_at: string
  updated_at: string
  deleted_at: string | null
}

export interface SyncBookmarkTagRow {
  bookmark_id: string
  tag_id: string
  user_id: string
  created_at: string
}

export interface SyncChangeRow {
  id: number
  change_id: string
  user_id: string
  device_id: string
  entity_type: SyncEntityType
  entity_id: string
  operation: SyncOperationType
  revision: string
  payload_json: string | null
  changed_at: string
}

export interface SyncIdempotencyRow {
  user_id: string
  client_operation_id: string
  request_hash: string
  response_json: string
  expires_at: string
}

export interface SyncEntityRevisionRow {
  user_id: string
  entity_type: SyncEntityType
  entity_id: string
  revision: string
  updated_at: string
}

export interface SyncBookmarkFolderRow {
  id: string
  user_id: string
  name: string
  parent_id: string | null
  position: number
  is_deleted: number
  deleted_at: string | null
  created_at: string
  updated_at: string
}

export interface SyncTabGroupRow {
  id: string
  user_id: string
  title: string
  parent_id: string | null
  is_folder: number
  position: number
  color: string | null
  tags: string | null
  revision: string | null
  is_deleted: number
  deleted_at: string | null
  created_at: string
  updated_at: string
}

export interface SyncTabGroupItemRow {
  id: string
  group_id: string
  title: string
  url: string
  favicon: string | null
  position: number
  is_pinned: number
  is_todo: number
  is_archived: number
  created_at: string
}
