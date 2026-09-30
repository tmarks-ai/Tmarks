import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getAIOrganizerSettings, saveAIConnection, saveAIOrganizerSettings } from '@tmarks/ai'

/**
 * The extension storage adapter persists ALL AI keys to chrome.storage.local:
 * connections (with BYOK API keys — same posture as the backend API key in
 * tmark:auth), the active id, and organizer preferences all survive browser
 * restarts. Copies left in chrome.storage.session by pre-persistence builds
 * migrate into local on first read, so the upgrade is seamless. These tests
 * pin the routing and the migration.
 */

interface MockArea {
  data: Map<string, unknown>
  get(key: string): Promise<Record<string, unknown>>
  set(values: Record<string, unknown>): Promise<void>
  remove(key: string): Promise<void>
}

function createMockArea(): MockArea {
  const area: MockArea = {
    data: new Map<string, unknown>(),
    async get(key) {
      const value = area.data.get(key)
      return value === undefined ? {} : { [key]: value }
    },
    async set(values) {
      for (const [k, v] of Object.entries(values)) area.data.set(k, v)
    },
    async remove(key) {
      area.data.delete(key)
    },
  }
  return area
}

let session: MockArea
let local: MockArea

beforeEach(async () => {
  session = createMockArea()
  local = createMockArea()
  vi.stubGlobal('chrome', { storage: { session, local } })
  const { createChromeAIStorage } = await import('../src/lib/ai/ai-storage')
  const { configureAIStorage } = await import('@tmarks/ai')
  configureAIStorage(createChromeAIStorage())
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('extension AI storage persists in storage.local', () => {
  it('saves connections (with the API key) and the active id to storage.local', async () => {
    await saveAIConnection({
      provider: 'openai',
      protocol: 'openai-compatible',
      apiKey: 'sk-secret',
      baseUrl: 'https://api.openai.com/v1',
    })
    expect(local.data.has('tmarks.ai.connections')).toBe(true)
    expect(local.data.has('tmarks.ai.activeConnection')).toBe(true)
    expect(session.data.size).toBe(0)
  })

  it('saves organizer preferences to storage.local', async () => {
    await saveAIOrganizerSettings({ language: 'zh', tagCount: 4 })
    expect(local.data.has('tmarks.ai.organizerSettings')).toBe(true)
    expect(session.data.has('tmarks.ai.organizerSettings')).toBe(false)

    const settings = await getAIOrganizerSettings()
    expect(settings.language).toBe('zh')
    expect(settings.tagCount).toBe(4)
  })

  it('reads back saved connections across adapter instances (restart survival)', async () => {
    await saveAIConnection({
      provider: 'zhipu',
      protocol: 'openai-compatible',
      apiKey: 'sk-zhipu',
      baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    })

    // A fresh adapter instance sees only what is on disk — storage.local is
    // the single source of truth, nothing lives in per-instance memory.
    const { createChromeAIStorage } = await import('../src/lib/ai/ai-storage')
    const { configureAIStorage, getActiveAIConnection } = await import('@tmarks/ai')
    configureAIStorage(createChromeAIStorage())
    const active = await getActiveAIConnection()
    expect(active?.apiKey).toBe('sk-zhipu')
    expect(active?.model).toBe('glm-4-flash')
  })

  it('migrates session-area copies left by pre-persistence builds into storage.local', async () => {
    session.data.set('tmarks.ai.connections', [
      { id: 'legacy-1', provider: 'openai', apiKey: 'sk-old', baseUrl: 'https://api.openai.com/v1', protocol: 'openai-compatible' },
    ])
    session.data.set('tmarks.ai.organizerSettings', { language: 'en', tagCount: 6 })

    const { getActiveAIConnection } = await import('@tmarks/ai')
    const active = await getActiveAIConnection()
    expect(active?.apiKey).toBe('sk-old')
    const settings = await getAIOrganizerSettings()
    expect(settings.language).toBe('en')

    expect(local.data.has('tmarks.ai.connections')).toBe(true)
    expect(local.data.has('tmarks.ai.organizerSettings')).toBe(true)
    expect(session.data.has('tmarks.ai.connections')).toBe(false)
    expect(session.data.has('tmarks.ai.organizerSettings')).toBe(false)
  })
})
