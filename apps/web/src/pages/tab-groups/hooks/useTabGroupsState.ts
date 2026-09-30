import { useState } from 'react'
import type { TabGroupDTO, TabGroupItemDTO, TabGroupItemStatusFilter } from '@tmarks/contracts'
import type { TabGroupSortOption } from '@/lib/constants/tab-groups'

export type TabGroupDialog =
  | { type: 'createGroup'; parentId: string | null; isFolder: boolean }
  | { type: 'renameGroup'; group: TabGroupDTO }
  | { type: 'addItems'; group: TabGroupDTO }
  | { type: 'editItem'; item: TabGroupItemDTO }
  | { type: 'confirmDeleteGroup'; group: TabGroupDTO }
  | { type: 'confirmDeleteItem'; item: TabGroupItemDTO }
  | { type: 'moveGroup'; group: TabGroupDTO }
  | { type: 'moveItem'; item: TabGroupItemDTO }
  | { type: 'colorTag'; group: TabGroupDTO }
  | { type: 'dedup'; group: TabGroupDTO }

interface TabGroupsState {
  searchQuery: string
  setSearchQuery: (query: string) => void
  sortBy: TabGroupSortOption
  setSortBy: (sort: TabGroupSortOption) => void
  statusFilter: TabGroupItemStatusFilter
  setStatusFilter: (filter: TabGroupItemStatusFilter) => void
  selectedFolderId: string | null
  setSelectedFolderId: (id: string | null) => void
  dialog: TabGroupDialog | null
  openCreateFolder: (parentId: string | null) => void
  openCreateGroup: (parentId: string | null) => void
  openRenameGroup: (group: TabGroupDTO) => void
  openAddItems: (group: TabGroupDTO) => void
  openEditItem: (item: TabGroupItemDTO) => void
  openDeleteGroup: (group: TabGroupDTO) => void
  openDeleteItem: (item: TabGroupItemDTO) => void
  openMoveGroup: (group: TabGroupDTO) => void
  openMoveItem: (item: TabGroupItemDTO) => void
  openColorTag: (group: TabGroupDTO) => void
  openDedup: (group: TabGroupDTO) => void
  closeDialog: () => void
  batchMode: boolean
  selectedIds: string[]
  toggleSelect: (id: string) => void
  selectAll: (ids: string[]) => void
  clearSelection: () => void
  toggleBatch: () => void
}

/** 标签页收纳页面本地 UI 状态:搜索/排序/状态筛选/选中文件夹 + 统一对话框状态机 + 批量选择。 */
export function useTabGroupsState(): TabGroupsState {
  const [searchQuery, setSearchQuery] = useState('')
  const [sortBy, setSortBy] = useState<TabGroupSortOption>('created')
  const [statusFilter, setStatusFilter] = useState<TabGroupItemStatusFilter>('all')
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null)
  const [dialog, setDialog] = useState<TabGroupDialog | null>(null)
  const [batchMode, setBatchMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<string[]>([])

  return {
    searchQuery,
    setSearchQuery,
    sortBy,
    setSortBy,
    statusFilter,
    setStatusFilter,
    selectedFolderId,
    setSelectedFolderId,
    dialog,
    openCreateFolder: (parentId) => setDialog({ type: 'createGroup', parentId, isFolder: true }),
    openCreateGroup: (parentId) => setDialog({ type: 'createGroup', parentId, isFolder: false }),
    openRenameGroup: (group) => setDialog({ type: 'renameGroup', group }),
    openAddItems: (group) => setDialog({ type: 'addItems', group }),
    openEditItem: (item) => setDialog({ type: 'editItem', item }),
    openDeleteGroup: (group) => setDialog({ type: 'confirmDeleteGroup', group }),
    openDeleteItem: (item) => setDialog({ type: 'confirmDeleteItem', item }),
    openMoveGroup: (group) => setDialog({ type: 'moveGroup', group }),
    openMoveItem: (item) => setDialog({ type: 'moveItem', item }),
    openColorTag: (group) => setDialog({ type: 'colorTag', group }),
    openDedup: (group) => setDialog({ type: 'dedup', group }),
    closeDialog: () => setDialog(null),
    batchMode,
    selectedIds,
    toggleSelect: (id) => setSelectedIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id])),
    selectAll: (ids) => setSelectedIds(ids),
    clearSelection: () => setSelectedIds([]),
    toggleBatch: () => { setBatchMode((b) => !b); setSelectedIds([]) },
  }
}
