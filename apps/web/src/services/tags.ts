import { apiClient } from '@/lib/api-client'
import { unwrapData } from '@/lib/api-response'
import type {
  CreateTagInput,
  TagDTO,
  TagQueryParams,
  TagsResponse,
  UpdateTagInput,
} from '@tmarks/contracts'

function toTagQuery(params: TagQueryParams = {}): string {
  const sp = new URLSearchParams()
  if (params.sort) sp.set('sort', params.sort)
  const qs = sp.toString()
  return qs ? `?${qs}` : ''
}

export const tagsService = {
  async getTags(params?: TagQueryParams): Promise<TagsResponse> {
    return unwrapData(
      await apiClient.get<TagsResponse>(`/tags${toTagQuery(params)}`),
      'GET /tags',
    )
  },

  async createTag(data: CreateTagInput): Promise<TagDTO> {
    const res = await apiClient.post<{ tag: TagDTO }>('/tags', data)
    return unwrapData(res, 'POST /tags').tag
  },

  async updateTag(id: string, data: UpdateTagInput): Promise<TagDTO> {
    const res = await apiClient.patch<{ tag: TagDTO }>(`/tags/${id}`, data)
    return unwrapData(res, `PATCH /tags/${id}`).tag
  },

  async deleteTag(id: string): Promise<void> {
    await apiClient.delete(`/tags/${id}`)
  },

  async incrementClick(id: string): Promise<void> {
    await apiClient.patch(`/tags/${id}/click`, {})
  },
}
