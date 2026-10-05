import { apiClient } from '@/lib/api-client'
import { unwrapData } from '@/lib/api-response'
import type {
  BookmarkDTO,
  BatchActionRequest,
  BatchActionResponse,
  BookmarkQueryParams,
  BookmarksResponse,
  ClickResponse,
  CreateBookmarkInput,
  EmptyTrashResponse,
  ReorderBookmarksInput,
  ReorderBookmarksResult,
  ReorderPinnedInput,
  ReorderPinnedResult,
  TrashBookmark,
  TrashResponse,
  UpdateBookmarkInput,
  UrlMetadataResponse,
} from '@tmarks/contracts'

function toBookmarkQuery(params: BookmarkQueryParams = {}): string {
  const sp = new URLSearchParams()
  if (params.keyword) sp.set('keyword', params.keyword)
  if (params.tags) sp.set('tags', params.tags)
  if (params.page_size) sp.set('page_size', String(params.page_size))
  if (params.page_cursor) sp.set('page_cursor', params.page_cursor)
  if (params.sort) sp.set('sort', params.sort)
  if (params.pinned !== undefined) sp.set('pinned', String(params.pinned))
  if (params.folder_id) sp.set('folder_id', params.folder_id)
  if (params.status && params.status !== 'all') sp.set('status', params.status)
  const qs = sp.toString()
  return qs ? `?${qs}` : ''
}

export const bookmarksService = {
  async getBookmarks(params?: BookmarkQueryParams): Promise<BookmarksResponse> {
    return unwrapData(
      await apiClient.get<BookmarksResponse>(`/bookmarks${toBookmarkQuery(params)}`),
      'GET /bookmarks',
    )
  },

  /** Fetch all bookmarks across every page (for full-data export). */
  async getAllBookmarks(): Promise<BookmarkDTO[]> {
    const all: BookmarkDTO[] = []
    let cursor: string | undefined
    // R8 WE-9: 50-page safety cap, same as listAllTabGroups — a degenerate
    // cursor would otherwise loop forever.
    for (let page = 0; page < 50; page++) {
      const result = await bookmarksService.getBookmarks({ page_size: 100, page_cursor: cursor })
      all.push(...result.bookmarks)
      if (!result.meta?.has_more || !result.meta.next_cursor) break
      cursor = result.meta.next_cursor
    }
    return all
  },

  async createBookmark(data: CreateBookmarkInput): Promise<BookmarkDTO> {
    const res = await apiClient.post<{ bookmark: BookmarkDTO }>('/bookmarks', data)
    return unwrapData(res, 'POST /bookmarks').bookmark
  },

  async updateBookmark(id: string, data: UpdateBookmarkInput): Promise<BookmarkDTO> {
    const res = await apiClient.patch<{ bookmark: BookmarkDTO }>(`/bookmarks/${id}`, data)
    return unwrapData(res, `PATCH /bookmarks/${id}`).bookmark
  },

  async reorderPinned(data: ReorderPinnedInput): Promise<ReorderPinnedResult> {
    return unwrapData(
      await apiClient.post<ReorderPinnedResult>('/bookmarks/reorder-pinned', data),
      'POST /bookmarks/reorder-pinned',
    )
  },

  async reorderBookmarks(data: ReorderBookmarksInput): Promise<ReorderBookmarksResult> {
    return unwrapData(
      await apiClient.post<ReorderBookmarksResult>('/bookmarks/reorder', data),
      'POST /bookmarks/reorder',
    )
  },

  async deleteBookmark(id: string): Promise<void> {
    await apiClient.delete(`/bookmarks/${id}`)
  },

  async batchAction(data: BatchActionRequest): Promise<BatchActionResponse> {
    return unwrapData(
      await apiClient.post<BatchActionResponse>('/bookmarks/bulk', data),
      'POST /bookmarks/bulk',
    )
  },

  async restoreFromTrash(id: string): Promise<TrashBookmark> {
    const res = await apiClient.patch<{ bookmark: TrashBookmark }>(`/bookmarks/${id}/restore`, {})
    return unwrapData(res, `PATCH /bookmarks/${id}/restore`).bookmark
  },

  async permanentDelete(id: string): Promise<void> {
    await apiClient.delete(`/bookmarks/${id}/permanent`)
  },

  async emptyTrash(): Promise<EmptyTrashResponse> {
    return unwrapData(
      await apiClient.post<EmptyTrashResponse>('/bookmarks/trash/empty', {}),
      'POST /bookmarks/trash/empty',
    )
  },

  async recordClick(id: string): Promise<ClickResponse> {
    return unwrapData(
      await apiClient.post<ClickResponse>(`/bookmarks/${id}/click`),
      `POST /bookmarks/${id}/click`,
    )
  },

  /** 服务端抓取页面元数据(标题/描述/favicon/og:image),用于添加书签表单自动填充。 */
  async getUrlMetadata(url: string): Promise<UrlMetadataResponse> {
    const query = new URLSearchParams({ url })
    return unwrapData(
      await apiClient.get<UrlMetadataResponse>(`/bookmarks/url-metadata?${query}`),
      'GET /bookmarks/url-metadata',
    )
  },

  async getTrash(params?: {
    page_size?: number
    page_cursor?: string
    sort?: string
  }): Promise<TrashResponse> {
    const sp = new URLSearchParams()
    if (params?.page_size) sp.set('page_size', String(params.page_size))
    if (params?.page_cursor) sp.set('page_cursor', params.page_cursor)
    if (params?.sort) sp.set('sort', params.sort)
    const qs = sp.toString()
    return unwrapData(
      await apiClient.get<TrashResponse>(`/bookmarks/trash${qs ? `?${qs}` : ''}`),
      'GET /bookmarks/trash',
    )
  },
}
