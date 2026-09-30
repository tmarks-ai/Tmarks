import { apiClient } from '@/lib/api-client'
import { unwrapData } from '@/lib/api-response'
import type { PreferencesResponse, UpdatePreferencesInput } from '@tmarks/contracts'

export const preferencesService = {
  async getPreferences(): Promise<PreferencesResponse> {
    return unwrapData(await apiClient.get<PreferencesResponse>('/preferences'), 'GET /preferences')
  },

  async updatePreferences(data: UpdatePreferencesInput): Promise<PreferencesResponse> {
    return unwrapData(await apiClient.patch<PreferencesResponse>('/preferences', data), 'PATCH /preferences')
  },
}
