import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BUILT_IN_PRESETS } from '@tmarks/ai'

/**
 * loadProviderPresets 的回退链测试:远程清单 → 7 天内缓存 → 内置。
 * chrome.storage.local 与 fetch 全部走内存/桩实现。
 */

interface MockStorage {
  data: Map<string, unknown>
  get(key: string | string[]): Promise<Record<string, unknown>>
  set(values: Record<string, unknown>): Promise<void>
}

function installChromeMock(): MockStorage {
  const data = new Map<string, unknown>()
  const storage: MockStorage = {
    data,
    async get(key) {
      const keys = Array.isArray(key) ? key : [key]
      const result: Record<string, unknown> = {}
      for (const k of keys) {
        const value = data.get(k)
        if (value !== undefined) result[k] = value
      }
      return result
    },
    async set(values) {
      for (const [k, v] of Object.entries(values)) data.set(k, v)
    },
  }
  vi.stubGlobal('chrome', { storage: { local: storage } })
  return storage
}

function stubFetch(handler: (url: string) => Promise<Response>): void {
  vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => handler(String(input))))
}

const REMOTE_MANIFEST = {
  schema_version: 1,
  providers: [
    {
      id: 'openai',
      label: 'OpenAI',
      protocol: 'openai-compatible',
      baseUrl: 'https://relay.example/v1',
      defaultModel: 'gpt-relay',
      canFetchModels: true,
    },
    {
      id: 'moonshot',
      label: 'Moonshot',
      protocol: 'openai-compatible',
      baseUrl: 'https://api.moonshot.cn/v1',
      defaultModel: 'moonshot-v1-8k',
      canFetchModels: true,
    },
  ],
}

describe('loadProviderPresets', () => {
  let storage: MockStorage

  beforeEach(async () => {
    storage = installChromeMock()
    await storage.set({ 'tmark:apiOrigin': 'https://tmarks.example' })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('merges the remote manifest: overrides built-ins by id and appends new providers', async () => {
    stubFetch(async () => new Response(JSON.stringify(REMOTE_MANIFEST), { status: 200 }))
    const { loadProviderPresets } = await import('../src/lib/ai/presets')
    const presets = await loadProviderPresets()
    expect(presets.find((p) => p.id === 'openai')?.baseUrl).toBe('https://relay.example/v1')
    expect(presets.find((p) => p.id === 'moonshot')?.defaultModel).toBe('moonshot-v1-8k')
    expect(presets.find((p) => p.id === 'deepseek')).toBeDefined()
  })

  it('caches the manifest and serves it when the remote fetch fails', async () => {
    stubFetch(async () => new Response(JSON.stringify(REMOTE_MANIFEST), { status: 200 }))
    const { loadProviderPresets } = await import('../src/lib/ai/presets')
    await loadProviderPresets()
    expect(storage.data.has('tmark:aiPresetCache')).toBe(true)

    stubFetch(async () => {
      throw new Error('offline')
    })
    const presets = await loadProviderPresets()
    expect(presets.find((p) => p.id === 'openai')?.baseUrl).toBe('https://relay.example/v1')
    expect(presets.find((p) => p.id === 'moonshot')).toBeDefined()
  })

  it('ignores cache entries older than 7 days and falls back to built-ins', async () => {
    await storage.set({
      'tmark:aiPresetCache': { manifest: REMOTE_MANIFEST, fetchedAt: Date.now() - 8 * 24 * 60 * 60 * 1000 },
    })
    stubFetch(async () => {
      throw new Error('offline')
    })
    const { loadProviderPresets } = await import('../src/lib/ai/presets')
    const presets = await loadProviderPresets()
    expect(presets).toEqual(BUILT_IN_PRESETS)
  })

  it('treats a 200 SPA-HTML response as a failed fetch (built-in fallback)', async () => {
    stubFetch(async () => new Response('<html><body>not json</body></html>', { status: 200 }))
    const { loadProviderPresets } = await import('../src/lib/ai/presets')
    const presets = await loadProviderPresets()
    expect(presets).toEqual(BUILT_IN_PRESETS)
  })
})
