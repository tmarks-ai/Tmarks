import { apiClient } from '@/lib/api-client'
import { unwrapData } from '@/lib/api-response'
import type {
  ApiKeyCreatedResponse,
  ApiKeyCreateRequest,
  ApiKeysListResponse,
} from '@tmarks/contracts'

export const apiKeysService = {
  async listApiKeys(): Promise<ApiKeysListResponse> {
    return unwrapData(await apiClient.get<ApiKeysListResponse>('/settings/api-keys'), 'GET /settings/api-keys')
  },

  async createApiKey(data: ApiKeyCreateRequest): Promise<ApiKeyCreatedResponse> {
    return unwrapData(await apiClient.post<ApiKeyCreatedResponse>('/settings/api-keys', data), 'POST /settings/api-keys')
  },

  async revokeApiKey(id: string): Promise<void> {
    await apiClient.delete(`/settings/api-keys/${id}`)
  },
}
