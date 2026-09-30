import type { TabGroupDTO } from '@tmarks/contracts'

/** 按 parent_id 分组(根组 parent_id 为 null)。 */
export function buildGroupsByParent(groups: TabGroupDTO[]): Map<string | null, TabGroupDTO[]> {
  const groupsByParent = new Map<string | null, TabGroupDTO[]>()
  for (const group of groups) {
    const parentId = group.parent_id ?? null
    const children = groupsByParent.get(parentId)
    if (children) children.push(group)
    else groupsByParent.set(parentId, [group])
  }
  return groupsByParent
}

/** 内容组(非文件夹)。 */
export function isContentGroup(group: TabGroupDTO): boolean {
  return !group.is_folder
}

/** 组的标签页数(优先 item_count,兼容嵌套 items)。 */
function getGroupItemCount(group: TabGroupDTO): number {
  return group.item_count ?? group.items?.length ?? 0
}

/** 所有组的标签页总数。 */
export function countGroupItems(groups: TabGroupDTO[]): number {
  return groups.reduce((sum, group) => sum + getGroupItemCount(group), 0)
}

/** 收集 rootId 的所有后代(带 visited 防环),用于选中文件夹取子孙。 */
export function collectDescendantGroups(
  rootId: string,
  groupsByParent: Map<string | null, TabGroupDTO[]>,
): TabGroupDTO[] {
  const result: TabGroupDTO[] = []
  const visited = new Set<string>([rootId])
  const walk = (parentId: string) => {
    for (const child of groupsByParent.get(parentId) ?? []) {
      if (visited.has(child.id)) continue
      visited.add(child.id)
      result.push(child)
      if (child.is_folder) walk(child.id)
    }
  }
  walk(rootId)
  return result
}

/** 文件夹 → 展开取所有内容子组;内容组 → [自身]。 */
export function collectContentGroups(
  group: TabGroupDTO,
  groupsByParent: Map<string | null, TabGroupDTO[]>,
): TabGroupDTO[] {
  if (isContentGroup(group)) return [group]
  return collectDescendantGroups(group.id, groupsByParent).filter(isContentGroup)
}
