import type { EntityId } from './primitives'

export interface AuthUserDTO {
  id: EntityId
  username: string
  email: string | null
}

// ---- 请求 ----

export interface LoginRequest {
  username: string
  password: string
  remember_me?: boolean
}

/**
 * The refresh token travels as an HttpOnly cookie (`tmarks_rt`); the body is
 * empty for browser clients. The optional body field remains for non-browser
 * API consumers (e.g. CLI tools) that manage the cookie themselves.
 */
export interface RefreshTokenRequest {
  refresh_token?: string
}

export interface LogoutRequest {
  refresh_token?: string
  revoke_all?: boolean
}

// ---- 响应 ----

export interface LoginResponse {
  access_token: string
  token_type: 'Bearer'
  expires_in: number
  user: AuthUserDTO
}

export type RefreshTokenResponse = LoginResponse
