import { isLoopbackAIHostname, validateCustomBaseUrl } from './presets'

const MODEL_REQUEST_TIMEOUT = 15_000
const MAX_MODEL_RESPONSE_BYTES = 1024 * 1024

/** 从 OpenAI 兼容端点拉取模型列表(GET {baseUrl}/models)。 */
export async function fetchAIModels(baseUrl: string, apiKey: string): Promise<string[]> {
  const base = baseUrl.trim().replace(/\/+$/, '')
  if (!base) throw new Error('AI base URL is required.')
  if (validateCustomBaseUrl(base, isLoopbackAIHostname) !== 'ok') {
    throw new Error('AI base URL must use HTTPS, or HTTP only for a loopback host.')
  }
  if (!apiKey.trim()) throw new Error('AI API key is required.')

  const controller = new AbortController()
  const timeoutId = globalThis.setTimeout(() => controller.abort(), MODEL_REQUEST_TIMEOUT)
  try {
    const response = await fetch(`${base}/models`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${apiKey.trim()}`,
        'Content-Type': 'application/json',
      },
      signal: controller.signal,
    })
    if (!response.ok) throw new Error(`Model request failed (${response.status}).`)

    const text = await readResponseText(response)
    let data: unknown
    try {
      data = JSON.parse(text) as unknown
    } catch {
      throw new Error('Model service returned invalid JSON.')
    }
    const models = extractModelIds(data)
    if (models.length === 0) throw new Error('No models returned.')
    return models
  } finally {
    globalThis.clearTimeout(timeoutId)
  }
}

async function readResponseText(response: Response): Promise<string> {
  const reader = response.body?.getReader()
  if (!reader) return ''
  const chunks: Uint8Array[] = []
  let received = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (!value) continue
      received += value.byteLength
      if (received > MAX_MODEL_RESPONSE_BYTES) {
        await reader.cancel().catch(() => undefined)
        throw new Error('Model service response is too large.')
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  const bytes = new Uint8Array(received)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new TextDecoder().decode(bytes)
}

function extractModelIds(data: unknown): string[] {
  if (!data || typeof data !== 'object') return []
  const list = (data as Record<string, unknown>).data
  if (!Array.isArray(list)) return []
  return Array.from(new Set(list.map((item) => {
    if (!item || typeof item !== 'object') return ''
    const id = (item as Record<string, unknown>).id
    return typeof id === 'string' ? id.trim() : ''
  }).filter(Boolean))).slice(0, 80)
}
