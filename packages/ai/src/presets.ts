import { AI_DEFAULT_MODELS, AI_SERVICE_URLS, isAIProviderName } from './provider-config'
import type { AIProtocol, PresetManifest, ProviderPreset } from './types'

const BUILT_IN_PROVIDER_LABELS: Record<string, string> = {
  openai: 'OpenAI',
  claude: 'Claude',
  deepseek: 'DeepSeek',
  zhipu: 'Zhipu AI',
  modelscope: 'ModelScope',
  siliconflow: 'SiliconFlow',
  iflow: 'iFlow',
  custom: 'Custom',
}

/** 未知 id 原样显示(远程预设用清单自带的 label,存进连接后丢清单也能读)。 */
export function providerLabel(provider: string): string {
  return BUILT_IN_PROVIDER_LABELS[provider] ?? provider
}

/** 旧记录没有 protocol 快照时按 id 推导;claude 是唯一的原生协议。 */
export function deriveProtocol(provider: string): AIProtocol {
  return provider === 'claude' ? 'claude' : 'openai-compatible'
}

export function isAIProtocol(value: unknown): value is AIProtocol {
  return value === 'openai-compatible' || value === 'claude'
}

/** 内置 id 的默认 base URL;未知 id 返回空串。 */
export function builtInBaseUrl(provider: string): string {
  return isAIProviderName(provider) ? AI_SERVICE_URLS[provider] : ''
}

export function defaultModelFor(provider: string, protocol: AIProtocol): string {
  if (isAIProviderName(provider)) return AI_DEFAULT_MODELS[provider]
  return protocol === 'claude' ? AI_DEFAULT_MODELS.claude : AI_DEFAULT_MODELS.custom
}

const BUILT_IN_PRESET_IDS = ['openai', 'claude', 'deepseek', 'zhipu', 'modelscope', 'siliconflow', 'iflow'] as const
const BUILT_IN_MODEL_FETCH_IDS = new Set(['openai', 'deepseek', 'modelscope', 'siliconflow', 'iflow'])

/** 随扩展发布的兜底清单;远程清单同 id 覆盖、新 id 追加。 */
export const BUILT_IN_PRESETS: ProviderPreset[] = BUILT_IN_PRESET_IDS.map((id) => ({
  id,
  label: BUILT_IN_PROVIDER_LABELS[id] ?? id,
  protocol: deriveProtocol(id),
  baseUrl: AI_SERVICE_URLS[id],
  defaultModel: AI_DEFAULT_MODELS[id],
  canFetchModels: BUILT_IN_MODEL_FETCH_IDS.has(id),
}))

export function findPreset(presets: ProviderPreset[], id: string): ProviderPreset | null {
  return presets.find((preset) => preset.id === id) ?? null
}

const PRESET_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,31}$/
const MAX_PRESET_PROVIDERS = 32

/**
 * 校验远程预设清单。schema_version 不是 1、整体不是对象、或没有任何合法条目
 * → 返回 null(fail-closed 回退内置)。单个坏条目只丢自己,不拖垮整份清单。
 */
export function parsePresetManifest(value: unknown): PresetManifest | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  if (record.schema_version !== 1) return null
  if (!Array.isArray(record.providers)) return null
  const providers = record.providers
    .map(normalizePresetEntry)
    .filter((preset): preset is ProviderPreset => preset !== null)
    .slice(0, MAX_PRESET_PROVIDERS)
  if (providers.length === 0) return null
  return { schema_version: 1, providers }
}

function normalizePresetEntry(value: unknown): ProviderPreset | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  const id = typeof record.id === 'string' ? record.id.trim() : ''
  if (!PRESET_ID_PATTERN.test(id)) return null
  // 'custom' 是编辑器手输地址的逃生口,不允许被清单占用。
  if (id === 'custom') return null
  const label = typeof record.label === 'string' ? record.label.trim() : ''
  if (!label || label.length > 64) return null
  if (!isAIProtocol(record.protocol)) return null
  const baseUrl = parseHttpsBaseUrl(typeof record.baseUrl === 'string' ? record.baseUrl.trim() : '')
  if (!baseUrl) return null
  const defaultModel = typeof record.defaultModel === 'string' ? record.defaultModel.trim() : ''
  if (!defaultModel || defaultModel.length > 100) return null
  if (typeof record.canFetchModels !== 'boolean') return null
  return { id, label, protocol: record.protocol, baseUrl, defaultModel, canFetchModels: record.canFetchModels }
}

/**
 * 远程清单的 baseUrl 只接受 https:清单决定 Authorization 头发往哪里,一条 http
 * 条目等于把 API key 明文送上链路。手输 custom 保留回环 http 豁免,远程不保留。
 */
function parseHttpsBaseUrl(raw: string): string | null {
  if (!raw) return null
  try {
    const url = new URL(raw)
    if (url.protocol !== 'https:') return null
    if (url.username || url.password) return null
    if (url.hash) return null
    // query 会让 resolveEndpoint 把 /chat/completions 拼在 ?a=b 之后,产生坏 URL。
    if (url.search) return null
    return url.toString()
  } catch {
    return null
  }
}

export type CustomBaseUrlValidation = 'ok' | 'required' | 'invalid'

/**
 * custom 手输端点地址校验:必须 http(s);明文 http 仅放行回环主机——密钥会以
 * Bearer/x-api-key 发往该地址,非回环明文等于把 key 送上链路。编辑器的保存、
 * 测试、拉取模型三条路径都必须先过这道闸。
 */
export function validateCustomBaseUrl(raw: string, isLoopbackHostname: (host: string) => boolean): CustomBaseUrlValidation {
  const trimmed = raw.trim()
  if (!trimmed) return 'required'
  let parsed: URL
  try {
    parsed = new URL(trimmed)
  } catch {
    return 'invalid'
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash) return 'invalid'
  if (parsed.protocol === 'https:') return 'ok'
  if (parsed.protocol === 'http:' && isLoopbackHostname(parsed.hostname)) return 'ok'
  return 'invalid'
}

export function isLoopbackAIHostname(hostname: string): boolean {
  let normalized = hostname.trim().toLowerCase()
  // WHATWG URL.hostname keeps the brackets on IPv6 literals ("[::1]" — see
  // backend-core's public-url.ts), so the bare '::1' comparison below never
  // matched and http://[::1]:9000 was rejected at every gate while the tab
  // editor's own regex accepted it (R5-16). Strip the brackets first.
  if (normalized.startsWith('[') && normalized.endsWith(']')) {
    normalized = normalized.slice(1, -1)
  }
  return normalized === 'localhost' || normalized === '127.0.0.1' || normalized === '::1'
}

/** 远程预设同 id 覆盖内置、新 id 追加;内置独有条目保留,总量截到上限。 */
export function mergePresets(builtIn: ProviderPreset[], remote: ProviderPreset[]): ProviderPreset[] {
  const byId = new Map(builtIn.map((preset) => [preset.id, preset]))
  for (const preset of remote) {
    if (preset.id === 'custom') continue
    byId.set(preset.id, preset)
  }
  return Array.from(byId.values()).slice(0, MAX_PRESET_PROVIDERS)
}
