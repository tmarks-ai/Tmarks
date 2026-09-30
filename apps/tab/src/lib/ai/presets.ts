import {
  BUILT_IN_PRESETS,
  mergePresets,
  parsePresetManifest,
  type PresetManifest,
  type ProviderPreset,
} from '@tmarks/ai'
import { getApiOrigin } from '../api/config'

/** 应用侧统一 tmark: 前缀;ai 包内部的 tmarks.ai.* 键是包内私有命名(见 ai-storage)。 */
const PRESETS_CACHE_KEY = 'tmark:aiPresetCache'
const FETCH_TIMEOUT_MS = 5000
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000

interface PresetCacheEntry {
  manifest: PresetManifest
  fetchedAt: number
}

/**
 * 加载服务商预设列表:已配置的 API 源会下发 /ai-presets.json(Web 部署节奏
 * 更新,无需扩展发版);拉取失败回退上次成功缓存(7 天内),再回退扩展内置清单。
 * 预设缓存是非敏感公开数据,可落 chrome.storage.local(API key 的存储策略
 * 由 ai-storage 适配器统一管理,与这里无关)。任何失败都静默——预设只影响连接编辑器下拉的新增条目,
 * 永不影响已保存的连接(后者自带 protocol/baseUrl 快照)。
 */
export async function loadProviderPresets(): Promise<ProviderPreset[]> {
  const origin = await getApiOrigin()
  if (origin) {
    const manifest = await fetchRemoteManifest(origin)
    if (manifest) {
      await cacheManifest(manifest)
      return mergePresets(BUILT_IN_PRESETS, manifest.providers)
    }
  }
  const cached = await readCachedManifest()
  if (cached) return mergePresets(BUILT_IN_PRESETS, cached.providers)
  return BUILT_IN_PRESETS
}

async function fetchRemoteManifest(origin: string): Promise<PresetManifest | null> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    const response = await fetch(`${origin.replace(/\/+$/, '')}/ai-presets.json`, {
      signal: controller.signal,
    })
    if (!response.ok) return null
    return parsePresetManifest(await response.json())
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

async function cacheManifest(manifest: PresetManifest): Promise<void> {
  try {
    await chrome.storage.local.set({ [PRESETS_CACHE_KEY]: { manifest, fetchedAt: Date.now() } })
  } catch {
    // 缓存写失败不影响本次结果,只影响下次离线回退。
  }
}

async function readCachedManifest(): Promise<PresetManifest | null> {
  try {
    const item = await chrome.storage.local.get(PRESETS_CACHE_KEY)
    const entry = item[PRESETS_CACHE_KEY] as Partial<PresetCacheEntry> | undefined
    // 过期缓存按"从未拉取过"处理,避免离线扩展永远展示已下架的服务商。
    if (!entry || typeof entry.fetchedAt !== 'number' || Date.now() - entry.fetchedAt > CACHE_TTL_MS) return null
    return parsePresetManifest(entry.manifest)
  } catch {
    return null
  }
}
