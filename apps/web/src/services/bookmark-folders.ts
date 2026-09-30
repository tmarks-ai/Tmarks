import { apiClient } from '@/lib/api-client'
import { unwrapData } from '@/lib/api-response'
import type {
  BookmarkFolderDTO,
  CreateBookmarkFolderInput,
  FoldersResponse,
  ReorderBookmarkFoldersInput,
  ReorderBookmarkFoldersResult,
  UpdateBookmarkFolderInput,
} from '@tmarks/contracts'

export const bookmarkFoldersService = {
  async getFolders(): Promise<FoldersResponse> {
    return unwrapData(
      await apiClient.get<FoldersResponse>('/bookmark-folders'),
      'GET /bookmark-folders',
    )
  },

  async createFolder(data: CreateBookmarkFolderInput): Promise<BookmarkFolderDTO> {
    const res = await apiClient.post<{ folder: BookmarkFolderDTO }>('/bookmark-folders', data)
    return unwrapData(res, 'POST /bookmark-folders').folder
  },

  async updateFolder(id: string, data: UpdateBookmarkFolderInput): Promise<BookmarkFolderDTO> {
    const res = await apiClient.patch<{ folder: BookmarkFolderDTO }>(`/bookmark-folders/${id}`, data)
    return unwrapData(res, `PATCH /bookmark-folders/${id}`).folder
  },

  async deleteFolder(id: string): Promise<void> {
    await apiClient.delete(`/bookmark-folders/${id}`)
  },

  async reorderFolders(data: ReorderBookmarkFoldersInput): Promise<ReorderBookmarkFoldersResult> {
    return unwrapData(
      await apiClient.post<ReorderBookmarkFoldersResult>('/bookmark-folders/reorder', data),
      'POST /bookmark-folders/reorder',
    )
  },
}
