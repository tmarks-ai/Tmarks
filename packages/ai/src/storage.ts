import { builtInBaseUrl, defaultModelFor, deriveProtocol, isAIProtocol, providerLabel, isLoopbackAIHostname, validateCustomBaseUrl } from './presets'
import type { AIConnectionInfo } from './types'

const AI_CONNECTIONS_KEY = 'tmarks.ai.connections'
const AI_ACTIVE_CONNECTION_KEY = 'tmarks.ai.activeConnection'

export async function getAIConnections(): Promise<AIConnectionInfo[]> {
  const value = await readStorageValue(AI_CONNECTIONS_KEY)
  if (!Array.isArray(value)) return []
  return value.map(normalizeStoredAIConnection).filter((connection): connection is AIConnectionInfo => Boolean(connection))
}

export async function saveAIConnection(input: AIConnectionInfo): Promise<AIConnectionInfo> {
  const provider = input.provider.trim()
  if (!provider) throw new Error('AI provider is required.')
  // 写入边界同样校验:坏值按 id 推导,而不是带着坏协议进存储。
  const protocol = isAIProtocol(input.protocol) ? input.protocol : deriveProtocol(provider)
  const baseUrl = input.baseUrl.trim() || builtInBaseUrl(provider)
  if (!baseUrl) throw new Error('AI base URL is required.')
  if (validateCustomBaseUrl(baseUrl, isLoopbackAIHostname) !== 'ok') {
    throw new Error('AI base URL must use HTTPS, or HTTP only for a loopback host.')
  }
  const connections = await getAIConnections()
  const timestamp = Date.now()
  const normalized: AIConnectionInfo = {
    ...input,
    id: input.id || crypto.randomUUID(),
    provider,
    protocol,
    baseUrl,
    model: input.model?.trim() || defaultModelFor(provider, protocol),
    label: input.label?.trim() || providerLabel(provider),
    lastUsedAt: timestamp,
  }
  const next = [
    normalized,
    ...connections.filter((connection) => connection.id !== normalized.id),
  ].slice(0, 12)
  await writeStorageValues({
    [AI_CONNECTIONS_KEY]: next,
    [AI_ACTIVE_CONNECTION_KEY]: normalized.id,
  })
  return normalized
}

export async function getActiveAIConnection(): Promise<AIConnectionInfo | null> {
  const [connections, activeId] = await Promise.all([
    getAIConnections(),
    readStorageValue(AI_ACTIVE_CONNECTION_KEY),
  ])
  return connections.find((connection) => connection.id === activeId) ?? connections[0] ?? null
}

export async function deleteAIConnection(id: string): Promise<void> {
  const [connections, activeId] = await Promise.all([
    getAIConnections(),
    readStorageValue(AI_ACTIVE_CONNECTION_KEY),
  ])
  const next = connections.filter((connection) => connection.id !== id)
  await writeStorageValues({
    [AI_CONNECTIONS_KEY]: next,
    ...(activeId === id ? { [AI_ACTIVE_CONNECTION_KEY]: next[0]?.id ?? null } : {}),
  })
}

/**
 * 读入旧记录时补全 protocol/baseUrl 快照:protocol 缺失按 id 推导(旧版只有
 * 内置 provider);base URL 兼容旧字段名 apiUrl。清单撤下后遗留的动态 provider
 * 连接靠保存时的快照继续可用;既无快照又非内置 provider 的记录(调不了任何
 * 端点)直接丢弃。
 */
function normalizeStoredAIConnection(value: unknown): AIConnectionInfo | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  const provider = typeof record.provider === 'string' ? record.provider.trim() : ''
  if (!provider || typeof record.apiKey !== 'string' || !record.apiKey.trim()) return null
  const protocol = isAIProtocol(record.protocol) ? record.protocol : deriveProtocol(provider)
  const baseUrl = readBaseUrl(record, provider)
  if (!baseUrl || validateCustomBaseUrl(baseUrl, isLoopbackAIHostname) !== 'ok') return null
  return {
    id: typeof record.id === 'string' ? record.id : crypto.randomUUID(),
    provider,
    protocol,
    apiKey: record.apiKey.trim(),
    baseUrl,
    model: typeof record.model === 'string' && record.model.trim() ? record.model.trim() : defaultModelFor(provider, protocol),
    label: typeof record.label === 'string' && record.label.trim() ? record.label.trim() : providerLabel(provider),
    lastUsedAt: typeof record.lastUsedAt === 'number' ? record.lastUsedAt : undefined,
    lastTestedAt: typeof record.lastTestedAt === 'number' ? record.lastTestedAt : undefined,
    lastTestStatus: record.lastTestStatus === 'success' || record.lastTestStatus === 'failed' ? record.lastTestStatus : undefined,
    lastTestError: typeof record.lastTestError === 'string' ? record.lastTestError : undefined,
  }
}

function readBaseUrl(record: Record<string, unknown>, provider: string): string {
  if (typeof record.baseUrl === 'string' && record.baseUrl.trim()) return record.baseUrl.trim()
  if (typeof record.apiUrl === 'string' && record.apiUrl.trim()) return record.apiUrl.trim()
  return builtInBaseUrl(provider)
}

/**
 * 存储适配器:ai 包不直接触碰任何宿主平台(chrome.storage / localStorage)。
 * 扩展在启动时注入 chrome 实现(见 apps/tab/src/lib/ai,明文 local 持久化,
 * 与 SECURITY.md 披露一致),Web/其它宿主用默认 localStorage 实现。注入方
 * 决定安全等级;若某宿主需要会话级隔离,在注入的实现里做。
 */
export interface AIStorageAdapter {
  get(key: string): Promise<unknown>
  set(values: Record<string, unknown>): Promise<void>
  remove(key: string): Promise<void>
}

function defaultWebStorage(): AIStorageAdapter {
  return {
    async get(key) {
      const value = localStorage.getItem(key)
      if (!value) return null
      try {
        return JSON.parse(value)
      } catch {
        return value
      }
    },
    async set(values) {
      for (const [key, value] of Object.entries(values)) {
        localStorage.setItem(key, JSON.stringify(value))
      }
    },
    async remove(key) {
      localStorage.removeItem(key)
    },
  }
}

let storageAdapter: AIStorageAdapter = defaultWebStorage()

export function configureAIStorage(adapter: AIStorageAdapter): void {
  storageAdapter = adapter
}

/** 供包内模块共享当前适配器(见 settings.ts)。 */
export function storageAdapterFor(): AIStorageAdapter {
  return storageAdapter
}

async function readStorageValue(key: string): Promise<unknown> {
  return storageAdapter.get(key)
}

async function writeStorageValues(values: Record<string, unknown>): Promise<void> {
  await storageAdapter.set(values)
}
