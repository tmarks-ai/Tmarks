import { useCallback, useRef, useState } from 'react'
import {
  closestCenter,
  useSensor,
  useSensors,
  PointerSensor,
  KeyboardSensor,
  type CollisionDetection,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core'
import type { TabGroupDTO, TabGroupItemDTO } from '@tmarks/contracts'

export type ItemDropPosition = 'before' | 'after'

interface UseItemDragAndDropProps {
  tabGroups: TabGroupDTO[]
  onMoveItem: (itemId: string, targetGroupId: string, position: number) => void
}

/** 条目拖拽:PointerSensor+KeyboardSensor、closestCenter。用 window pointermove listener 存真实 viewport clientY(DragOverlay 模式下 @dnd-kit 的 pointerCoordinates/delta/translated 与 droppableRects 坐标系不一致),onDragMove(每次 move)用 clientY + overRect(viewport)精确判定 50/50 before/after;handleDragEnd 计算 position(同组 newPosition===active.position 防护避免 backend 错误 shift;跨组直接执行)。单次 POST /items/:id/move(backend 自动 shift/compact)。 */
export function useItemDragAndDrop({ tabGroups, onMoveItem }: UseItemDragAndDropProps) {
  const [activeId, setActiveId] = useState<string | null>(null)
  const [overId, setOverId] = useState<string | null>(null)
  const [dropPosition, setDropPosition] = useState<ItemDropPosition | null>(null)
  const overIdRef = useRef<string | null>(null)
  const overRectRef = useRef<{ top: number; height: number } | null>(null)
  const clientYRef = useRef<number | null>(null)
  const pointerMoveHandlerRef = useRef<((e: PointerEvent) => void) | null>(null)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor),
  )

  const collisionDetection: CollisionDetection = (args) => {
    const collisions = closestCenter(args)
    const id = collisions[0]?.id as string | null
    overIdRef.current = id ?? null
    const rect = id ? args.droppableRects.get(id) : undefined
    overRectRef.current = rect ? { top: rect.top, height: rect.height } : null
    return collisions
  }

  const findItemGroup = useCallback(
    (itemId: string): { group: TabGroupDTO; item: TabGroupItemDTO } | null => {
      for (const group of tabGroups) {
        const item = group.items?.find((i) => i.id === itemId)
        if (item) return { group, item }
      }
      return null
    },
    [tabGroups],
  )

  const detachPointerListener = useCallback(() => {
    if (pointerMoveHandlerRef.current) {
      window.removeEventListener('pointermove', pointerMoveHandlerRef.current)
      pointerMoveHandlerRef.current = null
    }
  }, [])

  const handleDragStart = useCallback((event: DragStartEvent) => {
    // 锁定条目不参与拖拽(行级 sortable 已禁用,此处为兜底)。
    if (findItemGroup(event.active.id as string)?.item.is_locked) return
    overIdRef.current = null
    overRectRef.current = null
    clientYRef.current = null
    const handler = (e: PointerEvent) => { clientYRef.current = e.clientY }
    pointerMoveHandlerRef.current = handler
    window.addEventListener('pointermove', handler)
    setActiveId(event.active.id as string)
  }, [findItemGroup])

  const handleDragMove = useCallback(() => {
    const id = overIdRef.current
    const overRect = overRectRef.current
    const clientY = clientYRef.current
    setOverId(id)
    if (!id || !overRect || clientY === null) { setDropPosition(null); return }
    const relativeYPercent = (clientY - overRect.top) / overRect.height
    setDropPosition(relativeYPercent < 0.5 ? 'before' : 'after')
  }, [])

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
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

      const source = findItemGroup(active.id as string)
      const target = findItemGroup(over.id as string)
      if (!source || !target) return

      const newPosition = currentDropPosition === 'after' ? target.item.position + 1 : target.item.position
      if (source.group.id === target.group.id && newPosition === source.item.position) return
      onMoveItem(source.item.id, target.group.id, newPosition)
    },
    [dropPosition, findItemGroup, onMoveItem, detachPointerListener],
  )

  const handleDragCancel = useCallback(() => {
    detachPointerListener()
    setActiveId(null)
    setOverId(null)
    setDropPosition(null)
    overIdRef.current = null
    overRectRef.current = null
    clientYRef.current = null
  }, [detachPointerListener])

  const activeItem = activeId ? findItemGroup(activeId)?.item ?? null : null

  return {
    dndContextProps: {
      sensors,
      collisionDetection,
      onDragStart: handleDragStart,
      onDragMove: handleDragMove,
      onDragEnd: handleDragEnd,
      onDragCancel: handleDragCancel,
    },
    activeId,
    activeItem,
    overId,
    dropPosition,
  }
}
