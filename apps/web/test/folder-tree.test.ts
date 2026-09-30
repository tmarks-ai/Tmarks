import { describe, expect, it } from 'vitest'
import type { BookmarkFolderDTO } from '@tmarks/contracts'
import { canDropFolderInside, getFolderWithDescendantIds } from '@/components/bookmarks/folders/folderTree'

/**
 * 目录树拖拽/删除的纯逻辑回归:
 * - canDropFolderInside:两级层级约束("inside"目标必须是无子级的一级目录,
 *   被拖节点不能带子树)——附十七 S2 的拖拽中校验与 drop 复核共用此函数。
 * - getFolderWithDescendantIds:任意深度子树收集——附十六 C2 的删除回退判定
 *   依赖它(此前只查一层子目录,删祖先后孙目录选中项静默空白)。
 */

function folder(id: string, parentId: string | null, children: BookmarkFolderDTO[] = []): BookmarkFolderDTO {
  return {
    id,
    name: id,
    parent_id: parentId,
    position: 0,
    bookmark_count: 0,
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
    children,
  }
}

describe('canDropFolderInside (two-level hierarchy rule)', () => {
  const primary = folder('primary', null)
  const secondary = folder('secondary', 'primary')
  const tree: BookmarkFolderDTO[] = [folder('root', null, [primary, secondary]), folder('other', null)]

  it('allows inside a childless primary folder', () => {
    expect(canDropFolderInside(tree, 'other', 'primary')).toBe(true)
  })

  it('rejects inside a secondary folder (would create a third level)', () => {
    expect(canDropFolderInside(tree, 'other', 'secondary')).toBe(false)
  })

  it('rejects dropping a folder with its own children inside anything', () => {
    // 被拖节点带子树:其子级将随行落地成第三级,后端必拒。
    const withChildren = folder('parent', null, [folder('child', 'parent')])
    const treeWithFamily = [withChildren, folder('target', null)]
    expect(canDropFolderInside(treeWithFamily, 'parent', 'target')).toBe(false)
  })

  it('rejects dropping onto itself', () => {
    expect(canDropFolderInside(tree, 'primary', 'primary')).toBe(false)
  })
})

describe('getFolderWithDescendantIds (arbitrary-depth subtree)', () => {
  it('collects the full subtree across all depths, not just direct children', () => {
    const grandchild = folder('grandchild', 'child')
    const child = folder('child', 'parent', [grandchild])
    const parent = folder('parent', null, [child])
    expect(getFolderWithDescendantIds(parent)).toEqual(['parent', 'child', 'grandchild'])
  })

  it('returns just the folder itself for a leaf', () => {
    expect(getFolderWithDescendantIds(folder('leaf', 'p'))).toEqual(['leaf'])
  })
})
