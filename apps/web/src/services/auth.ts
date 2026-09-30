import { apiClient } from '@/lib/api-client'
import { unwrapData } from '@/lib/api-response'
import type {
  LoginRequest,
  LoginResponse,
  RefreshTokenRequest,
  RefreshTokenResponse,
  LogoutRequest,
} from '@tmarks/contracts'

export const authService = {
  async login(data: LoginRequest): Promise<LoginResponse> {
    // credentials: 'include' stores the HttpOnly refresh cookie when the API
    // lives on a different origin than the SPA.
    return unwrapData(
      await apiClient.post<LoginResponse>('/auth/login', data, { credentials: 'include' }),
      'POST /auth/login'
    )
  },

  async refreshToken(data: RefreshTokenRequest): Promise<RefreshTokenResponse> {
    // The refresh token is read from the HttpOnly cookie server-side; the
    // body carries no credential. credentials: 'include' keeps the cookie
    // attached when the API lives on a different origin than the SPA.
    return unwrapData(
      await apiClient.post<RefreshTokenResponse>('/auth/refresh', data, { credentials: 'include' }),
      'POST /auth/refresh'
    )
  },

  async logout(data: LogoutRequest): Promise<void> {
    await apiClient.post('/auth/logout', data, { credentials: 'include' })
  },

  /**
   * Change the web account password. On success the server revokes EVERY
   * session (including this one) — callers must log out afterwards.
   */
  async changePassword(data: { current_password: string; new_password: string }): Promise<void> {
    await apiClient.post('/change-password', data)
  },
}
