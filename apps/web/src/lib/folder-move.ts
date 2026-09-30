import type { BookmarkFolderDTO, TabGroupDTO } from '@tmarks/contracts'
import { buildGroupsByParent, collectDescendantGroups } from '@/lib/tab-group-hierarchy'

export interface FlatMoveTarget {
  id: string
  label: string
  depth: number
}

/** 通用树扁平化(排除指定子树),供移动对话框共享。 */
function flattenTreeForMove<T extends { id: string; children?: T[] }>(
  roots: T[],
  excludeIds: ReadonlySet<string>,
  labelOf: (node: T) => string,
): FlatMoveTarget[] {
  const result: FlatMoveTarget[] = []
  const walk = (nodes: T[], depth: number) => {
    for (const node of nodes) {
      if (excludeIds.has(node.id)) continue
      result.push({ id: node.id, label: labelOf(node), depth })
      walk(node.children ?? [], depth + 1)
    }
  }
  walk(roots, 0)
  return result
}

/** 书签文件夹树 → 可移动目标列表(排除目标文件夹及其后代)。 */
export function flattenBookmarkFoldersForMove(
  folders: BookmarkFolderDTO[],
  excludeIds: ReadonlySet<string>,
): FlatMoveTarget[] {
  return flattenTreeForMove(folders, excludeIds, (folder) => folder.name)
}

/**
 * 标签组(平铺 parent_id 结构)→ 可移动的文件夹目标列表,排除目标组及其后代。
 * 只收录 is_folder 组,按树的先序输出。
 */
export function flattenTabGroupFoldersForMove(allGroups: TabGroupDTO[], excludeId: string): FlatMoveTarget[] {
  const groupsByParent = buildGroupsByParent(allGroups)
  const excluded = new Set([excludeId, ...collectDescendantGroups(excludeId, groupsByParent).map((g) => g.id)])

  const result: FlatMoveTarget[] = []
  const walk = (parentId: string | null, depth: number) => {
    for (const group of groupsByParent.get(parentId) ?? []) {
      if (excluded.has(group.id)) continue
      if (group.is_folder) {
        result.push({ id: group.id, label: group.title, depth })
        walk(group.id, depth + 1)
      }
    }
  }
  walk(null, 0)
  return result
}