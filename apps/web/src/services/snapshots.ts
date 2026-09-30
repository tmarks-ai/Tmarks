import type { BookmarkSnapshotsResponse } from '@tmarks/contracts'
import { apiClient } from '@/lib/api-client'
import { unwrapData } from '@/lib/api-response'

export const snapshotsService = {
  async list(bookmarkId: string): Promise<BookmarkSnapshotsResponse> {
    return unwrapData(
      await apiClient.get<BookmarkSnapshotsResponse>(`/bookmarks/${bookmarkId}/snapshots`),
      'GET bookmark snapshots',
    )
  },

  async readHtml(bookmarkId: string, snapshotId: string): Promise<string> {
    const response = await apiClient.raw(`/bookmarks/${bookmarkId}/snapshots/${snapshotId}`)
    if (!response.ok) throw new Error('Failed to load snapshot content')
    return response.text()
  },

  async remove(bookmarkId: string, snapshotId: string): Promise<void> {
    await unwrapData(
      await apiClient.delete<{ deleted: boolean }>(`/bookmarks/${bookmarkId}/snapshots/${snapshotId}`),
      'DELETE bookmark snapshot',
    )
  },
}
