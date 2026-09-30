const STORAGE_KEY = 'tmark:apiOrigin'

/**
 * 默认 API 源:仅 dev 构建指向本地 worker。生产构建默认为空——
 * 一个明文 `http://localhost:8787` 默认值会让未配置的新用户把
 * X-API-Key(账号完全凭证)明文发给本机 8787 端口,本地恶意进程
 * 抢注该端口即可收集密钥。留空时请求方(client.ts)fail-fast
 * 报"未配置",而不是悄悄打到不存在的 dev 服务器。
 */
export const DEFAULT_API_ORIGIN = import.meta.env.DEV ? 'http://localhost:8787' : ''

/** 读取 API 源(chrome.storage,缺省回退 DEFAULT_API_ORIGIN;未配置时为空串)。 */
export async function getApiOrigin(): Promise<string> {
  const item = await chrome.storage.local.get(STORAGE_KEY)
  const stored = item[STORAGE_KEY]
  return typeof stored === 'string' && stored ? stored : DEFAULT_API_ORIGIN
}

/**
 * 回环主机判定:明文 http 仅对回环地址放行(AI 源/自定义端点共用)。
 * WHATWG URL.hostname 对 IPv6 字面量返回不带方括号的 "::1"(见 packages/ai
 * presets.ts 的 isLoopbackAIHostname),两种形态都接受以保持判定口径一致。
 */
export function isLoopbackHostname(hostname: string): boolean {
  const normalized = hostname.trim().toLowerCase()
  const bare = normalized.startsWith('[') && normalized.endsWith(']') ? normalized.slice(1, -1) : normalized
  return bare === 'localhost' || bare === '127.0.0.1' || bare === '::1'
}

/**
 * 写入 API 源(options 页设置生产源时调用)。
 *
 * 仅允许 http(s),且非回环主机必须是 https:每个请求都会带上 X-API-Key,
 * 明文 http 会把账号密钥暴露在链路上。这里硬性拒绝而不是打警告。
 */
export async function setApiOrigin(origin: string): Promise<void> {
  const parsed = new URL(origin)
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`Unsupported API origin protocol: ${parsed.protocol}`)
  }
  if (parsed.protocol === 'http:' && !isLoopbackHostname(parsed.hostname)) {
    throw new Error(
      `Refusing to use a plaintext http origin for ${parsed.hostname}: the API key would be sent in the clear. Use https.`
    )
  }
  await chrome.storage.local.set({ [STORAGE_KEY]: origin })
}
