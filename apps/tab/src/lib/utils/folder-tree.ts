/**
 * 文件夹树扁平化(popup 文件夹下拉用):递归 BookmarkFolderDTO.children,带 depth 缩进,
 * 让原生 <select><option> 也能体现 2 层层级关系(对齐 web 端 flattenFolders)。
 */
import type { BookmarkFolderDTO } from '@tmarks/contracts'
import type { LocalFolder } from '../db'

interface FlatFolderOption {
  value: string
  label: string
  depth: number
}

/** 递归树 → 带深度缩进的扁平选项(label 前缀全角空格模拟缩进,原生 select 友好)。 */
export function flattenFolders(folders: BookmarkFolderDTO[]): FlatFolderOption[] {
  const out: FlatFolderOption[] = []
  const walk = (list: BookmarkFolderDTO[], depth: number): void => {
    for (const f of list) {
      out.push({ value: f.id, label: `${'　'.repeat(depth)}${f.name}`, depth })
      if (f.children?.length) walk(f.children, depth + 1)
    }
  }
  walk(folders, 0)
  return out
}

/**
 * 扁平本地文件夹(parent_id 引用)→ 带 children 的树(popup 下拉用)。
 * sync 链路只存扁平 LocalFolder(children=undefined),UI 层即时重建层级关系。
 */
export function buildFolderTree(flat: LocalFolder[]): BookmarkFolderDTO[] {
  const byParent = new Map<string | null, LocalFolder[]>()
  for (const f of flat) {
    const arr = byParent.get(f.parent_id)
    if (arr) arr.push(f)
    else byParent.set(f.parent_id, [f])
  }
  const build = (parentId: string | null): BookmarkFolderDTO[] =>
    (byParent.get(parentId) ?? []).map((f) => {
      const children = build(f.id)
      return {
        id: f.id, user_id: f.user_id, name: f.name, parent_id: f.parent_id,
        position: f.position, bookmark_count: f.bookmark_count,
        created_at: f.created_at, updated_at: f.updated_at, deleted_at: f.deleted_at,
        children: children.length ? children : undefined,
      }
    })
  return build(null)
}
