import { HttpClient, type AuthDelegate } from './http-client'
import { useAuthStore } from '@/stores/authStore'

export { ApiError } from './api-error'

const API_BASE_URL = import.meta.env.VITE_API_URL || '/api/v1'
export const apiClient = new HttpClient(API_BASE_URL)
export const publicApiClient = new HttpClient('/api/public', false)

// Wire the auth delegate AFTER both modules have fully evaluated — this is
// the single point where the circular import chain (http-client ← authStore
// ← auth service ← api-client ← http-client) is resolved via dependency
// injection instead of a direct import from http-client.ts.
apiClient.bindAuth({
  getAccessToken: () => useAuthStore.getState().accessToken,
  refresh: async () => {
    await useAuthStore.getState().refreshAccessToken()
  },
  onAuthFailure: () => {
    const { clearAuth } = useAuthStore.getState()
    clearAuth()
    if (!window.location.pathname.includes('/login')) {
      window.location.href = '/login'
    }
  },
} satisfies AuthDelegate)
