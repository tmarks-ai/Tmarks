import type { TabGroupSortOption } from '@/lib/constants/tab-groups'

/**
 * 标签页组视图排序。服务端规范序为 created_at DESC(`created` 与之对齐);
 * `title`/`count` 仅本地展示排序。
 */
export function sortTabGroupsForView<
  T extends { title: string; created_at: string; item_count?: number },
>(groups: T[], sortBy: TabGroupSortOption): T[] {
  const sorted = [...groups]
  switch (sortBy) {
    case 'title':
      return sorted.sort((a, b) => a.title.localeCompare(b.title, 'zh-CN'))
    case 'count':
      return sorted.sort((a, b) => (b.item_count ?? 0) - (a.item_count ?? 0))
    case 'created':
    default:
      return sorted.sort(
        (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
      )
  }
}
