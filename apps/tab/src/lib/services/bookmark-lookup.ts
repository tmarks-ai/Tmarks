import { normalizeUrlKey } from '@tmarks/ai/url'
import { db, type LocalBookmark } from '../db'

/**
 * 弹窗内的"归一化 URL → 未删除书签"单次全表扫描缓存。
 *
 * 书签保存视图与标签页采集视图原本各做一次 db.bookmarks.toArray()
 * ——书签数千条时,两次全表反序列化明显拖慢弹窗打开。popup 与后台
 * SW 是不同 JS 上下文,不能共用 badge 检测的缓存;但同一次 popup 会话
 * 内可以共享一次扫描(popup 生命周期以秒计):
 * - 模块级缓存,首个用到它的视图触发扫描;
 * - 本地保存书签后 invalidateBookmarkLookup() 失效,下次使用重扫;
 * - SW 侧同步 pull 在弹窗短暂打开期间落库的窗口极小,接受陈旧
 *   (标记只影响"已存"提示,不影响写入)。
 */
let cache: Promise<Map<string, LocalBookmark>> | null = null

/** 归一化 URL → 已存书签行(首个命中;并发打开的两个视图共享同一 Promise)。 */
export function bookmarksByUrlKey(): Promise<Map<string, LocalBookmark>> {
  cache ??= db.bookmarks.toArray().then((rows) => {
    const map = new Map<string, LocalBookmark>()
    for (const row of rows) {
      if (row.deleted_at) continue
      const key = normalizeUrlKey(row.url)
      if (!map.has(key)) map.set(key, row)
    }
    return map
  })
  return cache
}

/** 本地书签写入后调用:让"本页是否已存"判定与新写入一致。 */
export function invalidateBookmarkLookup(): void {
  cache = null
}
