import type { AIProviderName, InvokeParams } from './types'

export const AI_PROVIDER_NAMES: AIProviderName[] = [
  'openai',
  'claude',
  'deepseek',
  'zhipu',
  'modelscope',
  'siliconflow',
  'iflow',
  'custom',
]

export const AI_SERVICE_URLS: Record<AIProviderName, string> = {
  openai: 'https://api.openai.com/v1',
  claude: 'https://api.anthropic.com/v1',
  deepseek: 'https://api.deepseek.com/v1',
  zhipu: 'https://open.bigmodel.cn/api/paas/v4',
  modelscope: 'https://api-inference.modelscope.cn/v1',
  siliconflow: 'https://api.siliconflow.cn/v1',
  iflow: 'https://apis.iflow.cn/v1',
  custom: 'https://api.openai.com/v1',
}

export const AI_DEFAULT_MODELS: Record<AIProviderName, string> = {
  openai: 'gpt-4o-mini',
  claude: 'claude-3-5-haiku-latest',
  deepseek: 'deepseek-chat',
  zhipu: 'glm-4-flash',
  modelscope: 'Qwen/Qwen2.5-72B-Instruct',
  siliconflow: 'Qwen/Qwen2.5-72B-Instruct',
  iflow: 'generalv3.5',
  custom: 'gpt-4o-mini',
}

export function isAIProviderName(value: unknown): value is AIProviderName {
  return typeof value === 'string' && AI_PROVIDER_NAMES.includes(value as AIProviderName)
}

interface RequestPayload {
  url: string
  headers: Record<string, string>
  body: Record<string, unknown>
}

interface ProviderConfig {
  buildRequest: (params: InvokeParams) => RequestPayload
  extractContent: (data: unknown) => string | undefined
}

const SYSTEM_PROMPT = [
  'You are the TMarks bookmark classification engine.',
  'Return only valid JSON that matches the requested schema.',
  'Do not include markdown, explanations, warnings, or prose outside JSON.',
].join('\n')

/** 系统消息:调用方传入锁定的契约优先;缺省(如测试连接)回退极简 stub。 */
function systemMessage(params: InvokeParams): string {
  return params.system && params.system.trim() ? params.system : SYSTEM_PROMPT
}

/** 内置 provider 的 OpenAI 兼容请求怪癖;远程清单下发的新服务商不进此表,走保守默认。 */
const OPENAI_COMPATIBLE_QUIRKS: Record<string, { jsonMode?: boolean; additionalBody?: Record<string, unknown> }> = {
  openai: { jsonMode: true },
  deepseek: { jsonMode: true },
  modelscope: { additionalBody: { result_format: 'message' } },
  siliconflow: { additionalBody: { stream: false } },
  iflow: {},
  custom: { additionalBody: { stream: false } },
}

/** 按协议在运行时构造请求配置:内置与远程预设、custom 手输地址走同一条路径。 */
export function buildProviderConfig(params: InvokeParams): ProviderConfig {
  return params.protocol === 'claude' ? claudeConfig() : openAICompatibleConfig(params)
}

function claudeConfig(): ProviderConfig {
  return {
    buildRequest: (params) => ({
      url: resolveEndpoint(params.baseUrl, '/messages'),
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': params.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: {
        model: normalizeModel(params.model, AI_DEFAULT_MODELS.claude),
        system: systemMessage(params),
        max_tokens: normalizeMaxTokens(params.maxTokens, 1024),
        temperature: normalizeTemperature(params.temperature),
        messages: [
          {
            role: 'user',
            content: [{ type: 'text', text: params.prompt }],
          },
        ],
      },
    }),
    extractContent: anthropicExtractor,
  }
}

function openAICompatibleConfig(params: InvokeParams): ProviderConfig {
  const quirks = OPENAI_COMPATIBLE_QUIRKS[params.provider] ?? {}
  return {
    buildRequest: (callParams) => {
      const body: Record<string, unknown> = {
        model: normalizeModel(callParams.model, defaultOpenAICompatibleModel(params.provider)),
        messages: [
          { role: 'system', content: systemMessage(callParams) },
          { role: 'user', content: callParams.prompt },
        ],
        temperature: normalizeTemperature(callParams.temperature),
        max_tokens: normalizeMaxTokens(callParams.maxTokens, 800),
      }
      if (quirks.jsonMode) body.response_format = { type: 'json_object' }
      if (quirks.additionalBody) Object.assign(body, quirks.additionalBody)

      return {
        url: resolveEndpoint(params.baseUrl, '/chat/completions'),
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${callParams.apiKey}`,
        },
        body,
      }
    },
    extractContent: openAIStyleExtractor,
  }
}

/** 内置 id 用各自的默认模型;远程/未知 id 回退 openai 兼容的通用默认。 */
function defaultOpenAICompatibleModel(provider: string): string {
  return isAIProviderName(provider) && provider !== 'claude' ? AI_DEFAULT_MODELS[provider] : AI_DEFAULT_MODELS.custom
}

function resolveEndpoint(baseUrl: string, endpoint: string): string {
  const normalizedEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`
  const normalizedBase = baseUrl.trim().replace(/\/+$/, '')
  if (normalizedBase.endsWith(normalizedEndpoint)) return normalizedBase
  return `${normalizedBase}${normalizedEndpoint}`
}

function normalizeModel(model: string | undefined, fallback: string): string {
  return model?.trim() || fallback
}

function normalizeTemperature(value: number | undefined): number {
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value as number)) : 0.5
}

function normalizeMaxTokens(value: number | undefined, fallback: number): number {
  if (!Number.isFinite(value)) return fallback
  return Math.max(256, Math.min(8000, Math.round(value as number)))
}

function extractTextValue(value: unknown): string | undefined {
  if (typeof value === 'string') {
    const trimmed = value.trim()
    return trimmed || undefined
  }

  if (Array.isArray(value)) {
    const joined = value.map(extractTextValue).filter(Boolean).join('\n').trim()
    return joined || undefined
  }

  if (!value || typeof value !== 'object') return undefined
  const obj = value as Record<string, unknown>
  for (const key of ['text', 'content', 'value', 'output_text', 'reasoning_content']) {
    const extracted = extractTextValue(obj[key])
    if (extracted) return extracted
  }

  if (obj.text && typeof obj.text === 'object') {
    return extractTextValue((obj.text as Record<string, unknown>).value)
  }

  return undefined
}

function openAIStyleExtractor(data: unknown): string | undefined {
  if (!data || typeof data !== 'object') return undefined
  const dataObj = data as Record<string, unknown>
  const direct = extractTextValue(dataObj.output_text) ||
    extractTextValue(dataObj.text) ||
    extractTextValue(dataObj.message) ||
    extractTextValue(dataObj.output)
  if (direct) return direct

  const choices = dataObj.choices
  if (!Array.isArray(choices) || choices.length === 0) return undefined
  const firstChoice = choices[0]
  if (!firstChoice || typeof firstChoice !== 'object') return undefined
  const choice = firstChoice as Record<string, unknown>
  return extractTextValue(choice.message) || extractTextValue(choice.delta) || extractTextValue(choice.text)
}

function anthropicExtractor(data: unknown): string | undefined {
  if (!data || typeof data !== 'object') return undefined
  const obj = data as Record<string, unknown>
  const content = obj.content
  if (Array.isArray(content)) {
    const joined = content
      .map((item) => item && typeof item === 'object' ? extractTextValue(item) : undefined)
      .filter(Boolean)
      .join('\n')
      .trim()
    if (joined) return joined
  }
  return extractTextValue(obj.output_text)
}
