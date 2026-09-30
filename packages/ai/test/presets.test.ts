import { describe, expect, it, beforeEach } from 'vitest'
import {
  BUILT_IN_PRESETS,
  configureAIStorage,
  defaultModelFor,
  deriveProtocol,
  findPreset,
  getActiveAIConnection,
  getAIConnections,
  isLoopbackAIHostname,
  mergePresets,
  parsePresetManifest,
  saveAIConnection,
  validateCustomBaseUrl,
  type AIStorageAdapter,
} from '../src'

function memoryStorage(): AIStorageAdapter & { dump(): Map<string, unknown> } {
  const store = new Map<string, unknown>()
  return {
    async get(key) {
      return store.get(key)
    },
    async set(values) {
      for (const [key, value] of Object.entries(values)) store.set(key, value)
    },
    async remove(key) {
      store.delete(key)
    },
    dump() {
      return store
    },
  }
}

describe('parsePresetManifest', () => {
  const validEntry = {
    id: 'moonshot',
    label: 'Moonshot',
    protocol: 'openai-compatible',
    baseUrl: 'https://api.moonshot.cn/v1',
    defaultModel: 'moonshot-v1-8k',
    canFetchModels: true,
  }

  it('accepts a valid manifest', () => {
    const manifest = parsePresetManifest({ schema_version: 1, providers: [validEntry] })
    expect(manifest?.providers).toHaveLength(1)
    expect(manifest?.providers[0]?.id).toBe('moonshot')
  })

  it('rejects unknown schema versions, non-objects and empty lists', () => {
    expect(parsePresetManifest({ schema_version: 2, providers: [validEntry] })).toBeNull()
    expect(parsePresetManifest(null)).toBeNull()
    expect(parsePresetManifest('nope')).toBeNull()
    expect(parsePresetManifest({ schema_version: 1, providers: [] })).toBeNull()
    expect(parsePresetManifest({ schema_version: 1 })).toBeNull()
  })

  it('drops individual invalid entries but keeps the rest', () => {
    const manifest = parsePresetManifest({
      schema_version: 1,
      providers: [
        validEntry,
        { ...validEntry, id: 'HTTP Relay', baseUrl: 'http://attacker.example/v1' },
        { ...validEntry, id: 'bad-protocol', protocol: 'gemini' },
        { ...validEntry, id: 'custom' },
        { ...validEntry, id: 'no-model', defaultModel: '' },
      ],
    })
    expect(manifest?.providers.map((p) => p.id)).toEqual(['moonshot'])
  })

  it('requires https base URLs without credentials or fragments', () => {
    const variant = (baseUrl: string) => parsePresetManifest({
      schema_version: 1,
      providers: [{ ...validEntry, id: 'probe', baseUrl }],
    })
    expect(variant('http://api.moonshot.cn/v1')).toBeNull()
    expect(variant('https://user:pass@api.moonshot.cn/v1')).toBeNull()
    expect(variant('https://api.moonshot.cn/v1#frag')).toBeNull()
    expect(variant('ftp://api.moonshot.cn/v1')).toBeNull()
    expect(variant('https://api.moonshot.cn/v1')).not.toBeNull()
  })
})

describe('mergePresets', () => {
  it('overrides built-ins by id and appends new providers', () => {
    const remote = parsePresetManifest({
      schema_version: 1,
      providers: [
        { id: 'openai', label: 'OpenAI', protocol: 'openai-compatible', baseUrl: 'https://relay.example/v1', defaultModel: 'gpt-new', canFetchModels: true },
        { id: 'moonshot', label: 'Moonshot', protocol: 'openai-compatible', baseUrl: 'https://api.moonshot.cn/v1', defaultModel: 'moonshot-v1-8k', canFetchModels: true },
      ],
    })!
    const merged = mergePresets(BUILT_IN_PRESETS, remote.providers)
    expect(merged.find((p) => p.id === 'openai')?.baseUrl).toBe('https://relay.example/v1')
    expect(merged.find((p) => p.id === 'deepseek')?.baseUrl).toBe('https://api.deepseek.com/v1')
    expect(merged.map((p) => p.id)).toContain('moonshot')
  })

  it('never lets a remote entry claim the custom slot', () => {
    const hostile = mergePresets(BUILT_IN_PRESETS, [
      { id: 'custom', label: 'Fake', protocol: 'openai-compatible', baseUrl: 'https://evil.example/v1', defaultModel: 'x', canFetchModels: true },
    ])
    expect(findPreset(hostile, 'custom')).toBeNull()
  })
})


describe('connection storage', () => {
  let storage: ReturnType<typeof memoryStorage>

  beforeEach(() => {
    storage = memoryStorage()
    configureAIStorage(storage)
  })

  it('saves dynamic providers with protocol/baseUrl snapshots and activates them', async () => {
    const saved = await saveAIConnection({
      provider: 'moonshot',
      protocol: 'openai-compatible',
      apiKey: 'sk-1',
      baseUrl: 'https://api.moonshot.cn/v1',
    })
    expect(saved.model).toBe('gpt-4o-mini')
    expect(saved.label).toBe('moonshot')

    const active = await getActiveAIConnection()
    expect(active?.provider).toBe('moonshot')
    expect(active?.baseUrl).toBe('https://api.moonshot.cn/v1')
  })

  it('normalizes legacy records: derived protocol, apiUrl field, built-in fallbacks', async () => {
    storage.set({
      'tmarks.ai.connections': [{
        id: 'legacy-1',
        provider: 'claude',
        apiKey: 'sk-old',
        apiUrl: 'https://api.anthropic.com/v1',
      }],
      'tmarks.ai.activeConnection': 'legacy-1',
    })
    const [connection] = await getAIConnections()
    expect(connection?.protocol).toBe('claude')
    expect(connection?.baseUrl).toBe('https://api.anthropic.com/v1')
    expect(connection?.model).toBe('claude-3-5-haiku-latest')

    const active = await getActiveAIConnection()
    expect(active?.id).toBe('legacy-1')
  })

  it('drops orphaned records: unknown provider without a base URL snapshot', async () => {
    storage.set({
      'tmarks.ai.connections': [
        { id: 'orphan', provider: 'ghost-provider', apiKey: 'sk-2' },
        { id: 'kept', provider: 'ghost-provider', apiKey: 'sk-3', baseUrl: 'https://ghost.example/v1', protocol: 'openai-compatible' },
      ],
    })
    const connections = await getAIConnections()
    expect(connections.map((c) => c.id)).toEqual(['kept'])
  })
})

describe('preset helpers', () => {
  it('derives protocol and defaults for known and unknown ids', () => {
    expect(deriveProtocol('claude')).toBe('claude')
    expect(deriveProtocol('moonshot')).toBe('openai-compatible')
    expect(defaultModelFor('deepseek', 'openai-compatible')).toBe('deepseek-chat')
    expect(defaultModelFor('moonshot', 'openai-compatible')).toBe('gpt-4o-mini')
    expect(defaultModelFor('anything', 'claude')).toBe('claude-3-5-haiku-latest')
  })

  it('built-in presets stay consistent with the shipped constants', () => {
    expect(BUILT_IN_PRESETS.map((p) => p.id)).toEqual(['openai', 'claude', 'deepseek', 'zhipu', 'modelscope', 'siliconflow', 'iflow'])
    expect(BUILT_IN_PRESETS.every((p) => p.canFetchModels === (p.id !== 'claude' && p.id !== 'zhipu'))).toBe(true)
  })
})



describe('mergePresets limits', () => {
  const entry = (id: string) => ({
    id, label: `L-${id}`, protocol: 'openai-compatible' as const,
    baseUrl: `https://${id}.example/v1`, defaultModel: `m-${id}`, canFetchModels: false,
  })

  it('caps the merged list at 32 providers', () => {
    const remote = Array.from({ length: 40 }, (_, i) => entry(`p${i}`))
    expect(mergePresets(BUILT_IN_PRESETS, remote)).toHaveLength(32)
  })

  it('resolves duplicate remote ids last-wins', () => {
    const merged = mergePresets(BUILT_IN_PRESETS, [
      { ...entry('moonshot'), label: 'First' },
      { ...entry('moonshot'), label: 'Second' },
    ])
    expect(merged.filter((p) => p.id === 'moonshot')).toHaveLength(1)
    expect(merged.find((p) => p.id === 'moonshot')?.label).toBe('Second')
  })
})

describe('parsePresetManifest edges', () => {
  const validEntry = {
    id: 'moonshot', label: 'Moonshot', protocol: 'openai-compatible',
    baseUrl: 'https://api.moonshot.cn/v1', defaultModel: 'moonshot-v1-8k', canFetchModels: true,
  }

  it('caps providers at 32 entries', () => {
    const providers = Array.from({ length: 40 }, (_, i) => ({ ...validEntry, id: `p${i}` }))
    expect(parsePresetManifest({ schema_version: 1, providers })?.providers).toHaveLength(32)
  })

  it('rejects over-long labels and malformed ids', () => {
    expect(parsePresetManifest({ schema_version: 1, providers: [{ ...validEntry, label: 'x'.repeat(65) }] })).toBeNull()
    expect(parsePresetManifest({ schema_version: 1, providers: [{ ...validEntry, id: 'Bad_ID' }] })).toBeNull()
    expect(parsePresetManifest({ schema_version: 1, providers: [{ ...validEntry, id: 'x'.repeat(33) }] })).toBeNull()
  })

  it('rejects base URLs carrying a query string', () => {
    expect(parsePresetManifest({ schema_version: 1, providers: [{ ...validEntry, baseUrl: 'https://api.moonshot.cn/v1?x=1' }] })).toBeNull()
  })
})

describe('validateCustomBaseUrl', () => {
  const isLoopback = (host: string) => /^(localhost|127\.0\.0\.1|\[::1\])$/.test(host)

  it('accepts https and loopback http, rejects everything else', () => {
    expect(validateCustomBaseUrl('https://relay.example/v1', isLoopback)).toBe('ok')
    expect(validateCustomBaseUrl('http://localhost:11434/v1', isLoopback)).toBe('ok')
    expect(validateCustomBaseUrl('http://127.0.0.1:1234', isLoopback)).toBe('ok')
    expect(validateCustomBaseUrl('http://[::1]:9000/v1', isLoopback)).toBe('ok')
    expect(validateCustomBaseUrl('http://evil.example/v1', isLoopback)).toBe('invalid')
    // https 目的地是用户自己的选择,校验只管传输安全与回环豁免,不猜意图。
    expect(validateCustomBaseUrl('https://127.0.0.1.attacker.example/v1', isLoopback)).toBe('ok')
    expect(validateCustomBaseUrl('http://127.0.0.1.attacker.example/v1', isLoopback)).toBe('invalid')
    expect(validateCustomBaseUrl('javascript:alert(1)', isLoopback)).toBe('invalid')
    expect(validateCustomBaseUrl('not a url', isLoopback)).toBe('invalid')
    expect(validateCustomBaseUrl('   ', isLoopback)).toBe('required')
  })

  // R5-16: the test above injects its own bracket-accepting matcher — exactly
  // why the production matcher's bracket bug slipped through. This block
  // exercises the PRODUCTION isLoopbackAIHostname via validateCustomBaseUrl.
  it('accepts the IPv6 loopback in the bracketed form URL.hostname yields (production matcher)', () => {
    expect(validateCustomBaseUrl('http://[::1]:9000/v1', isLoopbackAIHostname)).toBe('ok')
    expect(validateCustomBaseUrl('http://localhost:11434/v1', isLoopbackAIHostname)).toBe('ok')
    expect(validateCustomBaseUrl('http://127.0.0.1:1234', isLoopbackAIHostname)).toBe('ok')
    // Fail-closed on every other IPv6/mapped form.
    expect(validateCustomBaseUrl('http://[::ffff:127.0.0.1]:9000/v1', isLoopbackAIHostname)).toBe('invalid')
    expect(validateCustomBaseUrl('http://[::2]:9000/v1', isLoopbackAIHostname)).toBe('invalid')
    expect(validateCustomBaseUrl('http://evil.example/v1', isLoopbackAIHostname)).toBe('invalid')
  })
})


