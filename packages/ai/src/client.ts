import { buildProviderConfig } from './provider-config'
import { isLoopbackAIHostname, validateCustomBaseUrl } from './presets'
import type { AIInvokeResult, AIProtocol, InvokeParams } from './types'

const DEFAULT_TIMEOUT = 35_000
const MAX_AI_RESPONSE_BYTES = 2 * 1024 * 1024

export async function callAI(params: InvokeParams, timeout = DEFAULT_TIMEOUT): Promise<AIInvokeResult> {
  if (!params.baseUrl.trim()) throw new Error('AI base URL is required.')
  if (validateCustomBaseUrl(params.baseUrl, isLoopbackAIHostname) !== 'ok') {
    throw new Error('AI base URL must use HTTPS, or HTTP only for a loopback host.')
  }
  if (!params.apiKey.trim()) throw new Error('AI API key is required.')

  const config = buildProviderConfig(params)
  const { url, headers, body } = config.buildRequest(params)
  const controller = new AbortController()
  const timeoutId = globalThis.setTimeout(() => controller.abort(), timeout)

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    })

    if (!response.ok) {
      throw new Error(`AI API request failed (${response.status}): ${await readErrorText(response)}`)
    }

    const data = JSON.parse(await readResponseText(response)) as unknown
    const content = config.extractContent(data)
    if (!content) throw new Error('AI service returned an empty or unsupported response.')

    return { content, raw: data }
  } finally {
    globalThis.clearTimeout(timeoutId)
  }
}

async function readErrorText(response: Response): Promise<string> {
  try {
    const body = await readResponseText(response)
    if (!body) return response.statusText || 'Unknown error'
    try {
      const parsed = JSON.parse(body) as Record<string, unknown>
      const error = parsed.error
      if (error && typeof error === 'object' && typeof (error as Record<string, unknown>).message === 'string') {
        return String((error as Record<string, unknown>).message)
      }
      if (typeof parsed.message === 'string') return parsed.message
      if (typeof parsed.error === 'string') return parsed.error
    } catch {
      return body.slice(0, 240)
    }
    return body.slice(0, 240)
  } catch (error) {
    return error instanceof Error ? error.message : 'Unknown error'
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
      if (received > MAX_AI_RESPONSE_BYTES) {
        await reader.cancel().catch(() => undefined)
        throw new Error('AI service response is too large.')
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

/** 测试连接:用极小 prompt 验证 protocol+baseUrl+key+model 可用。不抛错,返回 {ok,error?}。 */
export async function testAIConnection(connection: {
  provider: string
  protocol: AIProtocol
  baseUrl: string
  apiKey: string
  model?: string
}): Promise<{ ok: boolean; error?: string }> {
  try {
    await callAI(
      {
        provider: connection.provider,
        protocol: connection.protocol,
        baseUrl: connection.baseUrl,
        apiKey: connection.apiKey.trim(),
        model: connection.model?.trim() || undefined,
        prompt: 'Reply with the single word: ok',
        temperature: 0,
        maxTokens: 16,
      },
      20_000,
    )
    return { ok: true }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'test failed' }
  }
}
