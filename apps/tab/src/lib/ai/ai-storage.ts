import { configureAIStorage, type AIStorageAdapter } from '@tmarks/ai'

/**
 * 扩展侧 AI 存储适配器:全部键持久化到 chrome.storage.local——AI 连接
 * (含 API Key)、激活 id 与整理偏好都跨浏览器重启保存,与 tmark:auth 的
 * 后端 API Key 同等姿态(本机明文,manifest 无内容脚本,storage.local 只有
 * 扩展自身受信上下文可读)。用户可在连接列表随时查看/复制密钥。
 *
 * 旧版本曾把 AI 键写进 storage.session(浏览器关闭即清):首次读取时把
 * session 副本迁回 local 持久并清掉 session 原件。
 *
 * 没有 storage.local 时回退到内存 Map(非扩展宿主,仅当前生命周期有效)。
 */
function createChromeAIStorage(): AIStorageAdapter {
  const memory = new Map<string, unknown>()
  const localArea = typeof chrome !== 'undefined' ? chrome.storage?.local : undefined
  const sessionArea = typeof chrome !== 'undefined' ? chrome.storage?.session : undefined

  type Area = { get(key: string): Promise<Record<string, unknown>>; set(values: Record<string, unknown>): Promise<void>; remove(key: string): Promise<void> }
  const read = async (area: Area, key: string): Promise<unknown> => (await area.get(key))[key]

  return {
    async get(key) {
      if (localArea) {
        const value = await read(localArea, key)
        if (value !== undefined) return value
        if (sessionArea) {
          const legacy = await read(sessionArea, key)
          if (legacy !== undefined) {
            await localArea.set({ [key]: legacy })
            await sessionArea.remove(key)
            return legacy
          }
        }
        return memory.get(key)
      }
      return memory.get(key)
    },
    async set(values) {
      for (const [key, value] of Object.entries(values)) memory.set(key, value)
      if (localArea) await localArea.set(values)
    },
    async remove(key) {
      memory.delete(key)
      if (localArea) await localArea.remove(key)
      // 旧版本可能留有 session 副本,一并清掉。
      if (sessionArea) await sessionArea.remove(key)
    },
  }
}

/** 在扩展入口(popup/options main)调用一次,把 chrome 存储适配器注入 ai 包。 */
export function initAIStorage(): void {
  configureAIStorage(createChromeAIStorage())
}

export { createChromeAIStorage }
