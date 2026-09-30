import type { ISODateTimeString } from './primitives'
import type { BookmarkDTO } from './bookmarks'
import type { PublicBookmarkFolderDTO } from './folders'
import type { TagFilterDTO } from './tags'

export interface PublicShareSettingsDTO {
  enabled: boolean
  slug: string | null
  title: string | null
  description: string | null
  updated_at: ISODateTimeString | null
}

export interface PublicShareSettingsResponse {
  share: PublicShareSettingsDTO
}

export interface UpdatePublicShareSettingsInput {
  enabled?: boolean
  slug?: string | null
  title?: string | null
  description?: string | null
  regenerate_slug?: boolean
}

export type PublicBookmarkDTO = Omit<BookmarkDTO, 'user_id' | 'deleted_at' | 'is_private'>

type PublicShareTagDTO = TagFilterDTO

export interface PublicSharePageDTO {
  share: {
    slug: string
    title: string | null
    description: string | null
    updated_at: ISODateTimeString
  }
  bookmarks: PublicBookmarkDTO[]
  folders: PublicBookmarkFolderDTO[]
  tags: PublicShareTagDTO[]
  folder_stats: {
    total_count: number
    uncategorized_count: number
  }
  workspace: {
    nav_mode: 'folders' | 'tags'
  }
}

export interface PublicSharePageResponse {
  page: PublicSharePageDTO
}
