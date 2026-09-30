const STORAGE_KEY = 'tmark:auth'

/**
 * API Key 格式校验:镜像后端 backend-core/lib/api-key/generator.ts 的 isValidApiKeyFormat。
 * 格式 `tmk_(live|test)_[20 个 base62]`。保存前校验,避免贴错 key 后每次请求静默 401。
 */
const API_KEY_PATTERN = /^tmk_(live|test)_[a-zA-Z0-9]{20}$/
export function isValidApiKeyFormat(key: string): boolean {
  return API_KEY_PATTERN.test(key)
}

export interface Credentials {
  api_key?: string
}

export async function getCredentials(): Promise<Credentials> {
  const item = await chrome.storage.local.get(STORAGE_KEY)
  return (item[STORAGE_KEY] as Credentials | undefined) ?? {}
}

export async function saveCredentials(patch: Credentials): Promise<void> {
  const current = await getCredentials()
  await chrome.storage.local.set({ [STORAGE_KEY]: { ...current, ...patch } })
}

export async function clearCredentials(): Promise<void> {
  await chrome.storage.local.remove(STORAGE_KEY)
}

export async function getAuthHeaders(): Promise<Record<string, string>> {
  const credentials = await getCredentials()
  return credentials.api_key ? { 'X-API-Key': credentials.api_key } : {}
}

export function isAuthenticated(credentials: Credentials): boolean {
  return Boolean(credentials.api_key)
}
