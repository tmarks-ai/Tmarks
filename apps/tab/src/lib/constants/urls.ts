/**
 * TMark web app / API 链接(移植自旧版 constants/urls)。
 * footer "我的书签/我的收藏" 跳 apps/web(路由 / 与 /tab,由 API 源推导 base)。
 */
import { DEFAULT_API_ORIGIN, getApiOrigin } from '../api/config'

export interface TMarksUrls {
  BASE_URL: string
  API_BASE: string
  WEB_APP: string
  TAB_GROUPS: string
}

/** 由 base 拼出链接;base 缺省回退 DEFAULT_API_ORIGIN。 */
function getTMarksUrls(baseUrl?: string): TMarksUrls {
  const base = (baseUrl ?? DEFAULT_API_ORIGIN).replace(/\/+$/, '')
  return { BASE_URL: base, API_BASE: `${base}/api`, WEB_APP: `${base}/`, TAB_GROUPS: `${base}/tab` }
}

/** 从 API 源推导 web app base(去掉可能的 /api 后缀),返回链接;未配置源时返回 null,
 *  调用方据此禁用跳转按钮——返回空串字段会让 chrome.tabs.create({url:''}) 静默失败。 */
export async function loadTMarksUrls(): Promise<TMarksUrls | null> {
  const origin = await getApiOrigin()
  if (!origin) return null
  const base = origin.replace(/\/api\/?$/, '').replace(/\/+$/, '')
  return getTMarksUrls(base)
}
