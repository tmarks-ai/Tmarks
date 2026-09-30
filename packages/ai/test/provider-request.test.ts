import { describe, expect, it } from 'vitest'
import { buildProviderConfig, callAI, fetchAIModels, testAIConnection } from '../src'

/**
 * 请求构造与调用层测试:buildProviderConfig 两种协议的请求形态、内置怪癖、
 * fetchAIModels 的 /models 拉取、callAI 端到端(mock fetch)与 testAIConnection。
 */

describe('buildProviderConfig', () => {
  const baseParams = {
    provider: 'moonshot',
    apiKey: 'sk-test',
    baseUrl: 'https://api.moonshot.cn/v1',
    prompt: 'hi',
  }

  it('builds OpenAI-compatible chat requests for dynamic presets', () => {
    const config = buildProviderConfig({ ...baseParams, protocol: 'openai-compatible' })
    const request = config.buildRequest({ ...baseParams, protocol: 'openai-compatible' })
    expect(request.url).toBe('https://api.moonshot.cn/v1/chat/completions')
    expect(request.headers.Authorization).toBe('Bearer sk-test')
    expect(request.body.model).toBe('gpt-4o-mini')
    expect(request.body.response_format).toBeUndefined()
  })

  it('keeps built-in quirks: openai json mode, modelscope result_format', () => {
    const openai = buildProviderConfig({ ...baseParams, provider: 'openai', baseUrl: 'https://api.openai.com/v1', protocol: 'openai-compatible' })
    expect(openai.buildRequest({ ...baseParams, provider: 'openai', baseUrl: 'https://api.openai.com/v1', protocol: 'openai-compatible' }).body.response_format)
      .toEqual({ type: 'json_object' })

    const modelscope = buildProviderConfig({ ...baseParams, provider: 'modelscope', baseUrl: 'https://api-inference.modelscope.cn/v1', protocol: 'openai-compatible' })
    expect(modelscope.buildRequest({ ...baseParams, provider: 'modelscope', baseUrl: 'https://api-inference.modelscope.cn/v1', protocol: 'openai-compatible' }).body.result_format)
      .toBe('message')
  })

  it('builds native Claude messages requests', () => {
    const claudeParams = { ...baseParams, provider: 'claude', protocol: 'claude' as const, baseUrl: 'https://api.anthropic.com/v1' }
    const config = buildProviderConfig(claudeParams)
    const request = config.buildRequest(claudeParams)
    expect(request.url).toBe('https://api.anthropic.com/v1/messages')
    expect(request.headers['x-api-key']).toBe('sk-test')
    expect(request.headers['anthropic-version']).toBe('2023-06-01')
    expect(request.body.model).toBe('claude-3-5-haiku-latest')
    expect(request.body.system).toBeTypeOf('string')
  })
})
describe('fetchAIModels', () => {
  it('rejects an unsafe endpoint before sending the API key', async () => {
    await expect(fetchAIModels('http://evil.example/v1', 'sk-key')).rejects.toThrow('HTTPS')
  })

  it('hits {baseUrl}/models with the bearer key', async () => {
    const calls: Array<{ url: string; headers: Record<string, string> }> = []
    const originalFetch = globalThis.fetch
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), headers: (init?.headers ?? {}) as Record<string, string> })
      return new Response(JSON.stringify({ data: [{ id: 'm-a' }, { id: 'm-b' }, { id: 'm-a' }] }), { status: 200 })
    }) as typeof fetch
    try {
      const models = await fetchAIModels('https://api.moonshot.cn/v1/', ' sk-key ')
      expect(models).toEqual(['m-a', 'm-b'])
      expect(calls[0]?.url).toBe('https://api.moonshot.cn/v1/models')
      expect(calls[0]?.headers.Authorization).toBe('Bearer sk-key')
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})
describe('provider request quirks', () => {
  const params = (provider: string, protocol: 'openai-compatible' | 'claude', baseUrl: string) => ({
    provider,
    protocol,
    baseUrl,
    apiKey: 'sk-test',
    prompt: 'hi',
  })

  it('siliconflow and custom send stream:false; zhipu sends no extra body', () => {
    const siliconflow = buildProviderConfig(params('siliconflow', 'openai-compatible', 'https://api.siliconflow.cn/v1'))
    expect(siliconflow.buildRequest(params('siliconflow', 'openai-compatible', 'https://api.siliconflow.cn/v1')).body.stream).toBe(false)
    const custom = buildProviderConfig(params('custom', 'openai-compatible', 'https://relay.example/v1'))
    expect(custom.buildRequest(params('custom', 'openai-compatible', 'https://relay.example/v1')).body.stream).toBe(false)
    const zhipu = buildProviderConfig(params('zhipu', 'openai-compatible', 'https://open.bigmodel.cn/api/paas/v4'))
    const zhipuBody = zhipu.buildRequest(params('zhipu', 'openai-compatible', 'https://open.bigmodel.cn/api/paas/v4')).body
    expect(zhipuBody.response_format).toBeUndefined()
    expect(zhipuBody.stream).toBeUndefined()
  })
})
describe('callAI end to end (mocked fetch)', () => {
  const params = {
    provider: 'moonshot',
    protocol: 'openai-compatible' as const,
    baseUrl: 'https://api.moonshot.cn/v1',
    apiKey: 'sk-test',
    prompt: 'hi',
  }

  it('returns extracted content from a chat completion', async () => {
    const originalFetch = globalThis.fetch
    globalThis.fetch = (async () => new Response(
      JSON.stringify({ choices: [{ message: { content: '{"title":"ok"}' } }] }),
      { status: 200 },
    )) as typeof fetch
    try {
      const result = await callAI(params)
      expect(result.content).toBe('{"title":"ok"}')
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('surfaces provider error messages on non-ok responses', async () => {
    const originalFetch = globalThis.fetch
    globalThis.fetch = (async () => new Response(
      JSON.stringify({ error: { message: 'invalid_api_key' } }),
      { status: 401 },
    )) as typeof fetch
    try {
      await expect(callAI(params)).rejects.toThrow('401')
      await expect(callAI(params)).rejects.toThrow('invalid_api_key')
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('rejects unsupported response payloads', async () => {
    const originalFetch = globalThis.fetch
    globalThis.fetch = (async () => new Response(JSON.stringify({ unrelated: true }), { status: 200 })) as typeof fetch
    try {
      await expect(callAI(params)).rejects.toThrow('empty or unsupported')
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})
describe('testAIConnection', () => {
  it('reports failure without throwing when the endpoint errors', async () => {
    const originalFetch = globalThis.fetch
    globalThis.fetch = (async () => new Response('nope', { status: 500 })) as typeof fetch
    try {
      const result = await testAIConnection({
        provider: 'openai', protocol: 'openai-compatible',
        baseUrl: 'https://api.openai.com/v1', apiKey: 'sk-test',
      })
      expect(result.ok).toBe(false)
      expect(result.error).toContain('500')
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})
