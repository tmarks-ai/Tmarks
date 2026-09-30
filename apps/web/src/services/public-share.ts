import { apiClient, publicApiClient } from '@/lib/api-client'
import { unwrapData } from '@/lib/api-response'
import type {
  PublicSharePageResponse,
  PublicShareSettingsResponse,
  UpdatePublicShareSettingsInput,
} from '@tmarks/contracts'

export const publicShareService = {
  async getPage(slug: string): Promise<PublicSharePageResponse> {
    return unwrapData(await publicApiClient.get<PublicSharePageResponse>(`/share/${encodeURIComponent(slug)}`), 'GET /api/public/share/:slug')
  },

  async getSettings(): Promise<PublicShareSettingsResponse> {
    return unwrapData(await apiClient.get<PublicShareSettingsResponse>('/settings/public-share'), 'GET /settings/public-share')
  },

  async updateSettings(input: UpdatePublicShareSettingsInput): Promise<PublicShareSettingsResponse> {
    return unwrapData(await apiClient.put<PublicShareSettingsResponse>('/settings/public-share', input), 'PUT /settings/public-share')
  },
}
