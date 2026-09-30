import type { BookmarkFolderDTO } from '@tmarks/contracts'

/** 文件夹自身书签数 + 所有后代书签数之和。 */
export function getFolderTotalCount(folder: BookmarkFolderDTO): number {
  const childCount = (folder.children ?? []).reduce(
    (total, child) => total + getFolderTotalCount(child),
    0,
  )
  return folder.bookmark_count + childCount
}

/** 将嵌套文件夹树扁平化为带 parent_id 的列表(供 DnD 排序/兄弟查找使用,保留 children)。 */
export function flattenFolderTree(folders: BookmarkFolderDTO[]): BookmarkFolderDTO[] {
  return folders.flatMap((f) => [f, ...flattenFolderTree(f.children ?? [])])
}

/** 文件夹自身 id + 所有后代 id(用于按文件夹过滤时包含子文件夹书签)。 */
export function getFolderWithDescendantIds(folder: BookmarkFolderDTO): string[] {
  return [
    folder.id,
    ...(folder.children ?? []).flatMap((child) => getFolderWithDescendantIds(child)),
  ]
}

/** 在树中按 id 查找文件夹。 */
export function findFolderById(
  folders: BookmarkFolderDTO[],
  folderId: string,
): BookmarkFolderDTO | undefined {
  for (const folder of folders) {
    if (folder.id === folderId) return folder
    const child = findFolderById(folder.children ?? [], folderId)
    if (child) return child
  }
  return undefined
}

/** 取某文件夹及其全部后代的 id 列表(用于 list 路由 folder_id 过滤)。 */
export function getFolderFilterIds(folders: BookmarkFolderDTO[], folderId: string): string[] {
  const folder = findFolderById(folders, folderId)
  return folder ? getFolderWithDescendantIds(folder) : [folderId]
}

/** 将文件夹树扁平化为带深度缩进的选项列表(供 Radix Select)。 */
export function flattenFolders(
  folders: BookmarkFolderDTO[],
  depth = 0,
): Array<{ value: string; label: string }> {
  return folders.flatMap((folder) => [
    {
      value: folder.id,
      label: `${depth > 0 ? `${'  '.repeat(depth)}- ` : ''}${folder.name}`,
      ...flattenFolders(folder.children ?? [], depth + 1),
    },
  ])
}

/**
 * 目录层级只有两级:"inside"目标必须是无子级的一级目录,且被拖节点自身
 * 不能带子树(否则其子级落地成第三级,后端必拒)。拖拽 hook 在拖拽中与
 * drop 时各调用一次(指示显示 + 权威复核)。
 */
export function canDropFolderInside(
  folders: BookmarkFolderDTO[],
  activeId: string,
  targetId: string,
): boolean {
  if (activeId === targetId) return false
  const flat = flattenFolderTree(folders)
  const depthOf = (id: string): number => {
    let depth = 0
    let current: BookmarkFolderDTO | undefined = flat.find((f) => f.id === id)
    while (current) {
      depth += 1
      current = current.parent_id ? flat.find((f) => f.id === current!.parent_id) : undefined
    }
    return depth
  }
  if (depthOf(targetId) >= 2) return false
  return !findFolderById(folders, activeId)?.children?.length
}
