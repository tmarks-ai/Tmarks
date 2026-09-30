export interface ApiKeyDTO {
  id: string
  key_prefix: string
  name: string
  description: string | null
  permissions: string[]
  status: 'active' | 'revoked' | 'expired'
  expires_at: string | null
  last_used_at: string | null
  last_used_ip: string | null
  created_at: string
  updated_at: string
}

export interface ApiKeysListResponse {
  keys: ApiKeyDTO[]
  quota: {
    used: number
    limit: number
  }
}

export interface ApiKeyCreateRequest {
  name: string
  description?: string
  template?: 'READ_ONLY' | 'BASIC' | 'FULL'
  expires_at?: string | null
}

export interface ApiKeyCreatedResponse extends ApiKeyDTO {
  key: string
}
