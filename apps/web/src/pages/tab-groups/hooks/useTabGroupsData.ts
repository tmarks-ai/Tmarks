import { useMemo } from 'react'
import type { TabGroupDTO, TabGroupItemDTO, TabGroupItemStatusFilter } from '@tmarks/contracts'
import {
  buildGroupsByParent,
  collectContentGroups,
  isContentGroup,
} from '@/lib/tab-group-hierarchy'
import { sortTabGroupsForView } from '@/components/tab-groups/sortUtils'
import { fastIncludes } from '@/lib/search-utils'
import type { TabGroupSortOption } from '@/lib/constants/tab-groups'

function groupMatchesSearch(group: TabGroupDTO, query: string): boolean {
  if (fastIncludes(group.title, query)) return true
  return (group.items || []).some(
    (item) => fastIncludes(item.title, query) || fastIncludes(item.url, query),
  )
}

function itemMatchesStatus(item: TabGroupItemDTO, status: Exclude<TabGroupItemStatusFilter, 'all'>): boolean {
  if (status === 'todo') return Boolean(item.is_todo)
  if (status === 'pinned') return Boolean(item.is_pinned)
  return Boolean(item.is_archived)
}

/** 状态筛选:组内只保留匹配条目,丢弃空组(组头计数随 items.length 自动反映筛选后数量)。 */
function filterGroupsByStatus(
  groups: TabGroupDTO[],
  status: Exclude<TabGroupItemStatusFilter, 'all'>,
): TabGroupDTO[] {
  const filtered: TabGroupDTO[] = []
  for (const group of groups) {
    const items = (group.items || []).filter((item) => itemMatchesStatus(item, status))
    if (items.length > 0) filtered.push({ ...group, items })
  }
  return filtered
}

interface TabGroupsData {
  visibleGroups: TabGroupDTO[]
  layoutMode: 'root' | 'flat'
  hasAnyGroups: boolean
}

/** 查询编排:按选中文件夹(取子孙内容组)/搜索(全量内容组)/状态筛选(全量内容组+条目过滤)/根视图(全量)过滤 + 排序。
 *  状态筛选与搜索/文件夹范围可叠加;激活状态筛选时强制平铺布局。 */
export function useTabGroupsData(
  allGroups: TabGroupDTO[],
  searchQuery: string,
  sortBy: TabGroupSortOption,
  selectedFolderId: string | null,
  statusFilter: TabGroupItemStatusFilter,
): TabGroupsData {
  return useMemo(() => {
    const hasAnyGroups = allGroups.length > 0
    const groupsByParent = buildGroupsByParent(allGroups)
    const filteringByStatus = statusFilter !== 'all'
    const hasSearch = searchQuery.trim() !== ''
    let baseGroups: TabGroupDTO[]
    let layoutMode: 'root' | 'flat'
    if (selectedFolderId) {
      const selectedGroup = allGroups.find((g) => g.id === selectedFolderId)
      baseGroups = selectedGroup ? collectContentGroups(selectedGroup, groupsByParent) : []
      layoutMode = 'flat'
    } else if (hasSearch || filteringByStatus) {
      baseGroups = allGroups.filter(isContentGroup)
      layoutMode = 'flat'
    } else {
      baseGroups = allGroups
      layoutMode = 'root'
    }
    const searched = hasSearch
      ? baseGroups.filter((g) => groupMatchesSearch(g, searchQuery))
      : baseGroups
    const visibleGroups = filteringByStatus
      ? sortTabGroupsForView(filterGroupsByStatus(searched, statusFilter), sortBy)
      : sortTabGroupsForView(searched, sortBy)
    return { visibleGroups, layoutMode, hasAnyGroups }
  }, [allGroups, searchQuery, sortBy, selectedFolderId, statusFilter])
}