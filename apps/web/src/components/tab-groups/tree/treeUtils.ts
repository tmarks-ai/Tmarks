import type { TabGroupDTO } from '@tmarks/contracts'

export interface TabGroupTreeNode extends TabGroupDTO {
  children: TabGroupTreeNode[]
}

/** 递归计算分组及所有子分组的标签页总数(文件夹自身不计 item_count)。 */
export function getTotalItemCount(group: TabGroupTreeNode): number {
  if (!group.is_folder) return group.item_count
  return group.children.reduce((sum, child) => sum + getTotalItemCount(child), 0)
}

/** 构建树:两遍扫建 Map→挂 children→按 position 递归排序。服务端已拒绝环,此处的
 * visited 兜底保证即使历史数据含环也不会栈溢出(环上节点留为根,保持页面可用)。 */
export function buildTree(groups: TabGroupDTO[]): TabGroupTreeNode[] {
  const groupMap = new Map<string, TabGroupTreeNode>()
  const rootGroups: TabGroupTreeNode[] = []

  for (const group of groups) {
    groupMap.set(group.id, { ...group, children: [] })
  }

  const attached = new Set<string>()
  const attach = (node: TabGroupTreeNode, visiting: Set<string>): boolean => {
    if (visiting.has(node.id)) return false
    if (!node.parent_id) return true
    const parent = groupMap.get(node.parent_id)
    if (!parent) return true
    if (attached.has(parent.id)) {
      parent.children.push(node)
      attached.add(node.id)
      return true
    }
    visiting.add(node.id)
    if (attach(parent, visiting)) {
      parent.children.push(node)
      attached.add(node.id)
    }
    visiting.delete(node.id)
    return attached.has(node.id)
  }

  for (const group of groups) {
    const node = groupMap.get(group.id)
    if (!node || attached.has(node.id)) continue
    if (attach(node, new Set())) {
      if (!node.parent_id || !groupMap.has(node.parent_id)) rootGroups.push(node)
    } else {
      // 环:断开为根节点,避免递归排序栈溢出。
      rootGroups.push(node)
      attached.add(node.id)
    }
  }

  const sortByPosition = (nodes: TabGroupTreeNode[], visiting = new Set<string>()) => {
    nodes.sort((a, b) => a.position - b.position)
    for (const node of nodes) {
      if (node.children.length > 0 && !visiting.has(node.id)) {
        visiting.add(node.id)
        sortByPosition(node.children, visiting)
        visiting.delete(node.id)
      }
    }
  }
  sortByPosition(rootGroups)
  return rootGroups
}
