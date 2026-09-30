/**
 * "当前页是否已收纳"识别 + 图标 badge 提示(本地副本,即时/离线)。
 * - 已存为书签 → 绿✓(长期收藏)
 * - 未存书签但已采进某组 → 琥珀●(会话快照,与长期收藏区分)
 * 副本由 sync pull 落库 + 保存写镜像 + 采集写组条目。
 *
 * 每次导航都刷新 badge,而识别基准(全部书签/组条目 URL)只在本地写入时
 * 变化——此前每次导航全表 toArray + 逐行归一化,库越大越卡。改为内存
 * Set 缓存 + Dexie 表钩子失效(同 background 的 syncQueue 钩子模式):
 * 任一相关表创建/更新/删除都让两个缓存作废,下次 badge 重建一次。
 */
import { normalizeUrlKey } from '@tmarks/ai'
import { db } from '../db'
import { isCollectableTabUrl } from './tab-collection-rules'

let bookmarkedKeys: Set<string> | null = null
let collectedKeys: Set<string> | null = null

// R5-P3 badge race: two interleaved refreshBadge calls for the same tab
// (tabs.onUpdated completes → tabs.onActivated fires in the same tick) can
// land their setBadgeText out of order — the slower first call overwrites
// the newer result with stale state until the next tab event. A per-tab
// generation token lets the late writer detect it lost and stay silent.
const badgeGeneration = new Map<number, number>()

function invalidateDetectionCaches(): void {
  bookmarkedKeys = null
  collectedKeys = null
  badgeGeneration.clear()
}

// 所有本地写入都走 Dexie(保存镜像/采集/同步 pull),钩子保证缓存不会
// 把已删除或新写入的 URL 判错;模块每上下文只求值一次,钩子不重复注册。
for (const table of [db.bookmarks, db.tabGroups, db.tabGroupItems]) {
  table.hook('creating', invalidateDetectionCaches)
  table.hook('updating', invalidateDetectionCaches)
  table.hook('deleting', invalidateDetectionCaches)
}

/**
 * 查本地书签副本是否已存该 url。
 * 与保存路径同一把尺(normalizeUrlKey):utm 参数/尾斜杠变体也算已存,
 * 否则 badge 会把"刚同步下来的同一页面"误报为未收纳。
 */
async function isUrlBookmarked(url: string): Promise<boolean> {
  const key = normalizeUrlKey(url)
  if (bookmarkedKeys === null) {
    const all = await db.bookmarks.toArray()
    bookmarkedKeys = new Set(
      all.filter((bm) => !bm.deleted_at).map((bm) => normalizeUrlKey(bm.url))
    )
  }
  return bookmarkedKeys.has(key)
}

/** 查是否已采进任一组(同 url 命中未删除组内的条目即算,同样按归一化键比对)。 */
async function isUrlInGroup(url: string): Promise<boolean> {
  const key = normalizeUrlKey(url)
  if (collectedKeys === null) {
    const [items, groups] = await Promise.all([db.tabGroupItems.toArray(), db.tabGroups.toArray()])
    const liveGroupIds = new Set(groups.filter((g) => !g.deleted_at).map((g) => g.id))
    collectedKeys = new Set(
      items.filter((it) => liveGroupIds.has(it.group_id)).map((it) => normalizeUrlKey(it.url))
    )
  }
  return collectedKeys.has(key)
}

/** 为 tab 设置 badge:书签绿✓ / 组琥珀● / 未收纳清空;未登录或非网页清空。后到者不得覆盖新结果。 */
export async function refreshBadge(tabId: number, url: string | undefined, authed: boolean): Promise<void> {
  const generation = (badgeGeneration.get(tabId) ?? 0) + 1
  badgeGeneration.set(tabId, generation)
  const isStale = () => badgeGeneration.get(tabId) !== generation

  if (!url || !isCollectableTabUrl(url) || !authed) {
    if (isStale()) return
    await chrome.action.setBadgeText({ tabId, text: '' })
    return
  }
  if (await isUrlBookmarked(url)) {
    if (isStale()) return
    await chrome.action.setBadgeText({ tabId, text: '✓' })
    await chrome.action.setBadgeBackgroundColor({ tabId, color: '#22c55e' })
    return
  }
  if (await isUrlInGroup(url)) {
    if (isStale()) return
    await chrome.action.setBadgeText({ tabId, text: '●' })
    await chrome.action.setBadgeBackgroundColor({ tabId, color: '#f59e0b' })
    return
  }
  if (isStale()) return
  await chrome.action.setBadgeText({ tabId, text: '' })
}
