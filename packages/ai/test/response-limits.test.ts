import { describe, expect, it } from 'vitest'
import { callAI, fetchAIModels } from '../src'

/**
 * R5 审计识别的 AI 包测试缺口回归:响应体积上限(2MB/1MB)、超时中止接线、
 * 调用时 URL 白名单、非 JSON 响应的干净报错。全部针对当前正确行为(R5-15/16
 * 的已登记缺陷不在本文件断言范围内)。
 */

function streamOf(totalBytes: number, chunkSize = 128 * 1024): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      let sent = 0
      while (sent < totalBytes) {
        const size = Math.min(chunkSize, totalBytes - sent)
        controller.enqueue(new Uint8Array(size).fill(120)) // 'x'
        sent += size
      }
      controller.close()
    },
  })
}

const params = {
  provider: 'moonshot',
  protocol: 'openai-compatible' as const,
  baseUrl: 'https://api.moonshot.cn/v1',
  apiKey: 'sk-test',
  prompt: 'hi',
}

describe('callAI response size caps (2MB success / shared error path)', () => {
  it('rejects a streamed success body over 2MB instead of buffering it', async () => {
    const originalFetch = globalThis.fetch
    globalThis.fetch = (async () =>
      new Response(streamOf(3 * 1024 * 1024), { status: 200 })) as typeof fetch
    try {
      await expect(callAI(params)).rejects.toThrow('AI service response is too large.')
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('caps oversized error bodies on the non-ok path too', async () => {
    const originalFetch = globalThis.fetch
    globalThis.fetch = (async () =>
      new Response(streamOf(3 * 1024 * 1024), { status: 500 })) as typeof fetch
    try {
      await expect(callAI(params)).rejects.toThrow('AI service response is too large.')
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})

describe('callAI timeout is wired to AbortController', () => {
  it('aborts a hanging provider after the given timeout', async () => {
    const originalFetch = globalThis.fetch
    let observedSignal: AbortSignal | undefined
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      observedSignal = init?.signal
      return await new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))
      })
    }) as typeof fetch
    try {
      await expect(callAI(params, 25)).rejects.toThrow()
      expect(observedSignal?.aborted).toBe(true)
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})

describe('callAI validates the base URL before any network call', () => {
  it('rejects a non-https endpoint without touching fetch', async () => {
    let fetchCalls = 0
    const originalFetch = globalThis.fetch
    globalThis.fetch = (async () => {
      fetchCalls += 1
      throw new Error('fetch must not be called')
    }) as typeof fetch
    try {
      await expect(callAI({ ...params, baseUrl: 'http://evil.example/v1' })).rejects.toThrow('HTTPS')
      expect(fetchCalls).toBe(0)
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})

describe('fetchAIModels hardening (1MB cap, strict JSON)', () => {
  it('rejects a streamed model list over 1MB', async () => {
    const originalFetch = globalThis.fetch
    globalThis.fetch = (async () =>
      new Response(streamOf(2 * 1024 * 1024), { status: 200 })) as typeof fetch
    try {
      await expect(fetchAIModels('https://api.moonshot.cn/v1', 'sk-key'))
        .rejects.toThrow('Model service response is too large.')
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('reports invalid JSON with a clean error', async () => {
    const originalFetch = globalThis.fetch
    globalThis.fetch = (async () => new Response('not json{{', { status: 200 })) as typeof fetch
    try {
      await expect(fetchAIModels('https://api.moonshot.cn/v1', 'sk-key'))
        .rejects.toThrow('Model service returned invalid JSON.')
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('rejects an empty body with a thrown error (never resolves silently)', async () => {
    const originalFetch = globalThis.fetch
    globalThis.fetch = (async () => new Response('', { status: 200 })) as typeof fetch
    try {
      await expect(fetchAIModels('https://api.moonshot.cn/v1', 'sk-key')).rejects.toThrow()
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})
