import { useCallback, useRef, useState } from 'react'
import {
  closestCenter,
  pointerWithin,
  useSensor,
  useSensors,
  PointerSensor,
  KeyboardSensor,
  type CollisionDetection,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core'
import type { TabGroupDTO } from '@tmarks/contracts'
import { buildGroupsByParent, collectDescendantGroups } from '@/lib/tab-group-hierarchy'

export type DropPosition = 'before' | 'inside' | 'after'

interface UseTreeDragAndDropProps {
  tabGroups: TabGroupDTO[]
  onMoveGroup: (groupId: string, newParentId: string | null, newPosition: number) => void
}

/** 树拖拽:PointerSensor+KeyboardSensor、pointerWithin→closestCenter。用 window pointermove listener 存真实 viewport clientY(DragOverlay 模式下 @dnd-kit 的 pointerCoordinates/delta/translated 与 droppableRects 坐标系不一致),onDragMove(每次 move)用 clientY + overRect(viewport)精确判定文件夹 25/50/25 vs 组 50/50 drop bands;isDescendant 防环;handleDragEnd 计算 newParentId+position。 */
export function useTreeDragAndDrop({ tabGroups, onMoveGroup }: UseTreeDragAndDropProps) {
  const [activeId, setActiveId] = useState<string | null>(null)
  const [overId, setOverId] = useState<string | null>(null)
  const [dropPosition, setDropPosition] = useState<DropPosition | null>(null)
  const overIdRef = useRef<string | null>(null)
  const overRectRef = useRef<{ top: number; height: number } | null>(null)
  const clientYRef = useRef<number | null>(null)
  const pointerMoveHandlerRef = useRef<((e: PointerEvent) => void) | null>(null)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor),
  )

  const collisionDetection: CollisionDetection = (args) => {
    const pointerCollisions = pointerWithin(args)
    const collisions = pointerCollisions && pointerCollisions.length > 0 ? pointerCollisions : closestCenter(args)
    const id = collisions[0]?.id as string | null
    overIdRef.current = id ?? null
    const rect = id ? args.droppableRects.get(id) : undefined
    overRectRef.current = rect ? { top: rect.top, height: rect.height } : null
    return collisions
  }

  const detachPointerListener = useCallback(() => {
    if (pointerMoveHandlerRef.current) {
      window.removeEventListener('pointermove', pointerMoveHandlerRef.current)
      pointerMoveHandlerRef.current = null
    }
  }, [])

  const handleDragStart = useCallback((event: DragStartEvent) => {
    // 锁定组不参与拖拽。
    if (tabGroups.find((g) => g.id === event.active.id)?.is_locked) return
    overIdRef.current = null
    overRectRef.current = null
    clientYRef.current = null
    const handler = (e: PointerEvent) => { clientYRef.current = e.clientY }
    pointerMoveHandlerRef.current = handler
    window.addEventListener('pointermove', handler)
    setActiveId(event.active.id as string)
  }, [tabGroups])

  const handleDragMove = useCallback(() => {
    const id = overIdRef.current
    const overRect = overRectRef.current
    const clientY = clientYRef.current
    setOverId(id)
    if (!id || !overRect || clientY === null) { setDropPosition(null); return }
    const overGroup = tabGroups.find((g) => g.id === id)
    if (!overGroup) { setDropPosition(null); return }
    const relativeYPercent = (clientY - overRect.top) / overRect.height
    if (overGroup.is_folder) {
      if (relativeYPercent < 0.25) setDropPosition('before')
      else if (relativeYPercent > 0.75) setDropPosition('after')
      else setDropPosition('inside')
    } else {
      setDropPosition(relativeYPercent < 0.5 ? 'before' : 'after')
    }
  }, [tabGroups])

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event
    const currentDropPosition = dropPosition
    detachPointerListener()
    setActiveId(null)
    setOverId(null)
    setDropPosition(null)
    overIdRef.current = null
    overRectRef.current = null
    clientYRef.current = null
    if (!over || active.id === over.id) return

    const draggedGroup = tabGroups.find((g) => g.id === active.id)
    const targetGroup = tabGroups.find((g) => g.id === over.id)
    if (!draggedGroup || !targetGroup) return

    if (currentDropPosition === 'inside' && targetGroup.is_folder) {
      if (draggedGroup.is_folder) {
        const groupsByParent = buildGroupsByParent(tabGroups)
        const descendants = collectDescendantGroups(draggedGroup.id, groupsByParent)
        if (descendants.some((d) => d.id === targetGroup.id)) return
      }
      onMoveGroup(draggedGroup.id, targetGroup.id, 0)
      return
    }

    const newParentId = targetGroup.parent_id ?? null
    // 兄弟序必须与渲染序(buildTree 按 position ASC)一致:tabGroups 来自
    // created_at DESC 的列表接口,用它算落点索引,拖一次就把全组写成创建序。
    const siblings = tabGroups.filter((g) => (g.parent_id ?? null) === newParentId).sort((a, b) => a.position - b.position)
    let targetIndex = siblings.findIndex((g) => g.id === targetGroup.id)
    if (currentDropPosition === 'after') targetIndex++
    const currentIndex = siblings.findIndex((g) => g.id === draggedGroup.id)
    if (currentIndex !== -1 && currentIndex < targetIndex) targetIndex--
    onMoveGroup(draggedGroup.id, newParentId, Math.max(0, targetIndex))
  }, [dropPosition, tabGroups, onMoveGroup, detachPointerListener])

  const handleDragCancel = useCallback(() => {
    detachPointerListener()
    setActiveId(null)
    setOverId(null)
    setDropPosition(null)
    overIdRef.current = null
    overRectRef.current = null
    clientYRef.current = null
  }, [detachPointerListener])

  return {
    sensors,
    collisionDetection,
    activeId,
    overId,
    dropPosition,
    handleDragStart,
    handleDragMove,
    handleDragEnd,
    handleDragCancel,
  }
}
