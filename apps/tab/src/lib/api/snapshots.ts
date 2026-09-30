import type { BookmarkSnapshotDTO, BookmarkSnapshotsResponse, CreateBookmarkSnapshotInput } from '@tmarks/contracts'
import { apiClient, unwrapData } from './client'

export const snapshotsApi = {
  async list(bookmarkId: string): Promise<BookmarkSnapshotsResponse> {
    return unwrapData(await apiClient.get<BookmarkSnapshotsResponse>(`/api/v1/bookmarks/${bookmarkId}/snapshots`), 'GET bookmark snapshots')
  },

  async create(bookmarkId: string, input: CreateBookmarkSnapshotInput): Promise<BookmarkSnapshotDTO> {
    const response = await apiClient.post<{ snapshot: BookmarkSnapshotDTO }>(`/api/v1/bookmarks/${bookmarkId}/snapshots`, input)
    return (await unwrapData(response, 'POST bookmark snapshot')).snapshot
  },

  async remove(bookmarkId: string, snapshotId: string): Promise<void> {
    await unwrapData(await apiClient.delete<{ deleted: boolean }>(`/api/v1/bookmarks/${bookmarkId}/snapshots/${snapshotId}`), 'DELETE bookmark snapshot')
  },

  async readHtml(bookmarkId: string, snapshotId: string): Promise<string> {
    const response = await apiClient.raw(`/api/v1/bookmarks/${bookmarkId}/snapshots/${snapshotId}`)
    if (!response.ok) throw new Error('Failed to open snapshot')
    return response.text()
  },
}
