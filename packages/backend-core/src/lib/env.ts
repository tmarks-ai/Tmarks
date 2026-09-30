export interface Env {
  DB: D1Database
  SNAPSHOTS?: R2Bucket
  CORS_ALLOWED_ORIGINS?: string
  JWT_SECRET: string
  ENVIRONMENT?: string
  ALLOW_REGISTRATION?: string
  JWT_ACCESS_TOKEN_EXPIRES_IN?: string
  JWT_REFRESH_TOKEN_EXPIRES_IN?: string
  PBKDF2_ITERATIONS?: string
  API_KEY_MAX_ACTIVE_PER_USER?: string
  SYNC_MAX_BATCH_SIZE?: string
  RATE_LIMITER?: RateLimit
  /** Dedicated high-quota limiter for public asset reads (separate rate from
   *  the auth-plane RATE_LIMITER — see lib/api-key/rate-limit-binding.ts). */
  ASSET_RATE_LIMITER?: RateLimit
  /** High-quota limiter for `*:global` unauthenticated buckets (login/register/
   *  share spray bounds), so they are not clamped by RATE_LIMITER's 60/min. */
  GLOBAL_RATE_LIMITER?: RateLimit
}

export interface AuthContext {
  user_id: string
  auth_type: 'jwt' | 'api_key'
  /** JWT-only: the server-side session the access token is bound to. */
  session_id?: string
  api_key_id?: string
  api_key_permissions?: string[]
}

export interface AppEnv {
  Bindings: Env
  Variables: {
    auth?: AuthContext
  }
}
