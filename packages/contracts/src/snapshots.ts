import type { EntityId, ISODateTimeString } from './primitives'

export interface BookmarkSnapshotDTO {
  id: EntityId
  bookmark_id: EntityId
  version: number
  snapshot_title: string
  source_url: string
  content_type: string
  content_size: number
  content_hash: string
  is_latest: boolean
  created_at: ISODateTimeString
}

export interface BookmarkSnapshotsResponse {
  snapshots: BookmarkSnapshotDTO[]
  total: number
}

export interface CreateBookmarkSnapshotInput {
  html_content: string
  title?: string
  url?: string
}
