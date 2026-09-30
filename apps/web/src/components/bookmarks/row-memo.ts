/** 书签行组件的 memo 比较器(卡片视图与极简列表行共用)。
 *
 * 搜索键击等父级重渲染时,行级 memo 让整页卡片(可达 200 张)跳过重渲染。
 * 行回调是父级按行重建的闭包,但其捕获物(bookmark)即 prop 本身,行为对
 * 同一 bookmark 等价,故只比较存在性;真正决定渲染的 props 恒等比较。
 * overId/dropPosition 是拖拽指示器,必须参与比较(卡片视图无此 props,
 * undefined 恒等,不受影响)。
 */
export function bookmarkRowPropsEqual<
  T extends {
    bookmark: unknown
    isSelected?: boolean
    readOnly?: boolean
    batchMode?: boolean
    overId?: string | null
    dropPosition?: string | null
    sortable?: boolean
    onEdit?: unknown
    onTogglePin?: unknown
    onToggleTodo?: unknown
    onToggleArchive?: unknown
    onMove?: unknown
    onToggleSelect?: unknown
  },
>(prev: T, next: T): boolean {
  return (
    prev.bookmark === next.bookmark &&
    prev.isSelected === next.isSelected &&
    prev.readOnly === next.readOnly &&
    prev.batchMode === next.batchMode &&
    prev.overId === next.overId &&
    prev.dropPosition === next.dropPosition &&
    prev.sortable === next.sortable &&
    (prev.onEdit === undefined) === (next.onEdit === undefined) &&
    (prev.onTogglePin === undefined) === (next.onTogglePin === undefined) &&
    (prev.onToggleTodo === undefined) === (next.onToggleTodo === undefined) &&
    (prev.onToggleArchive === undefined) === (next.onToggleArchive === undefined) &&
    (prev.onMove === undefined) === (next.onMove === undefined) &&
    (prev.onToggleSelect === undefined) === (next.onToggleSelect === undefined)
  )
}
