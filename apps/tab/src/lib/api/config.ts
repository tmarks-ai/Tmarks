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
  // 读路径同样规范化(R8 TA-2):存量用户存储的尾斜杠形态无需手动迁移。
  return typeof stored === 'string' && stored ? normalizeApiOrigin(stored) : DEFAULT_API_ORIGIN
}

/**
 * 规范化 API 源(R8 TA-2):去尾斜杠/query/hash,保留子路径前缀(反向代理
 * 的 /tmarks 部署合法)。尾斜杠曾让每个请求打中 `//api/...` 双斜杠路径——
 * Workers 的 run_worker_first 只认单斜杠 /api/*,SPA HTML 被当成 API 响应,
 * 队列按 NETWORK_ERROR 烧光重试预算。
 */
export function normalizeApiOrigin(origin: string): string {
  try {
    const parsed = new URL(origin)
    return `${parsed.protocol}//${parsed.host}${parsed.pathname.replace(/\/+$/, '')}`
  } catch {
    return origin.trim().replace(/\/+$/, '')
  }
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
  // 存储归一化形态(R8 TA-2):尾斜杠在此剥除,读取/桥接两侧同步消费。
  await chrome.storage.local.set({ [STORAGE_KEY]: normalizeApiOrigin(origin) })
}
