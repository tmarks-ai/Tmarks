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
import type { ReorderBookmarkItem } from '@tmarks/contracts'
import type { BookmarkDTO } from '@tmarks/contracts'

export type ItemDropPosition = 'before' | 'after'

interface UseBookmarkDragAndDropProps {
  bookmarks: BookmarkDTO[]
  onReorder: (updates: ReorderBookmarkItem[]) => void
}

/**
 * 书签条目拖拽(同文件夹 manual 排序重排):PointerSensor+KeyboardSensor、closestCenter。
 * 用 window pointermove listener 存真实 viewport clientY(DragOverlay 下 @dnd-kit 坐标系不一致),
 * onDragMove 用 clientY + overRect(viewport) 精确判定 50/50 before/after;
 * handleDragEnd 把 active 插到 over 的 before/after,重排为 0..n 连续 position,
 * 仅发送 position 变化的条目(POST /bookmarks/reorder 批量)。
 */
export function useBookmarkDragAndDrop({ bookmarks, onReorder }: UseBookmarkDragAndDropProps) {
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

  const detachPointerListener = useCallback(() => {
    if (pointerMoveHandlerRef.current) {
      window.removeEventListener('pointermove', pointerMoveHandlerRef.current)
      pointerMoveHandlerRef.current = null
    }
  }, [])

  const handleDragStart = useCallback((event: DragStartEvent) => {
    overIdRef.current = null
    overRectRef.current = null
    clientYRef.current = null
    const handler = (e: PointerEvent) => { clientYRef.current = e.clientY }
    pointerMoveHandlerRef.current = handler
    window.addEventListener('pointermove', handler)
    setActiveId(event.active.id as string)
  }, [])

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

      const fromIndex = bookmarks.findIndex((b) => b.id === active.id)
      const overIndex = bookmarks.findIndex((b) => b.id === over.id)
      if (fromIndex === -1 || overIndex === -1) return

      const next = [...bookmarks]
      const [moved] = next.splice(fromIndex, 1)
      let toIndex = currentDropPosition === 'after' ? overIndex + 1 : overIndex
      if (fromIndex < toIndex) toIndex -= 1
      next.splice(toIndex, 0, moved)

      const updates: ReorderBookmarkItem[] = []
      next.forEach((b, i) => { if (b.position !== i) updates.push({ id: b.id, position: i }) })
      if (updates.length > 0) onReorder(updates)
    },
    [bookmarks, dropPosition, onReorder, detachPointerListener],
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

  const activeBookmark = activeId ? bookmarks.find((b) => b.id === activeId) ?? null : null

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
    activeBookmark,
    overId,
    dropPosition,
  }
}
