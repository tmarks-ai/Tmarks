import { useCallback, useMemo, useRef, useState } from 'react'
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
import type { BookmarkFolderDTO } from '@tmarks/contracts'
import { findFolderById, flattenFolderTree, getFolderWithDescendantIds } from './folderTree'

export type FolderDropPosition = 'before' | 'inside' | 'after'

interface UseBookmarkFolderDragAndDropProps {
  folders: BookmarkFolderDTO[]
  onMoveFolder: (folderId: string, newParentId: string | null, newPosition: number) => void
}

/**
 * 文件夹树拖拽:PointerSensor+KeyboardSensor、pointerWithin→closestCenter。用 window pointermove
 * listener 存真实 viewport clientY(DragOverlay 模式下 @dnd-kit pointerCoordinates 与 droppableRects
 * 坐标系不一致),onDragMove 用 clientY + overRect(viewport)精确判定 25/50/25 before/inside/after;
 * handleDragEnd 计算 newParentId + position,before/inside/after 均用后代子树防环。镜像 tab-groups useTreeDragAndDrop。
 */
export function useBookmarkFolderDragAndDrop({ folders, onMoveFolder }: UseBookmarkFolderDragAndDropProps) {
  const flat = useMemo(() => flattenFolderTree(folders), [folders])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [overId, setOverId] = useState<string | null>(null)
  const [dropPosition, setDropPosition] = useState<FolderDropPosition | null>(null)
  const overIdRef = useRef<string | null>(null)
  const overRectRef = useRef<{ top: number; height: number } | null>(null)
  const clientYRef = useRef<number | null>(null)
  const pointerMoveHandlerRef = useRef<((e: PointerEvent) => void) | null>(null)
  const activeIdRef = useRef<string | null>(null)

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
    overIdRef.current = null
    overRectRef.current = null
    clientYRef.current = null
    activeIdRef.current = event.active.id as string
    const handler = (e: PointerEvent) => { clientYRef.current = e.clientY }
    pointerMoveHandlerRef.current = handler
    window.addEventListener('pointermove', handler)
    setActiveId(event.active.id as string)
  }, [])

  /** 目录层级只有两级:inside 目标必须是尚未有子级的一级目录,且被拖节点
   * 自身不能带子树(否则其子级落地成第三级,后端必拒)。拖拽中即时校验,
   * 非法 inside 不显示指示、drop 时再作权威复核。 */
  const canDropInside = useCallback((activeFolderId: string, targetFolderId: string): boolean => {
    if (activeFolderId === targetFolderId) return false
    const depthOf = (id: string): number => {
      let depth = 0
      let cur: BookmarkFolderDTO | undefined = flat.find((f) => f.id === id)
      while (cur) {
        depth += 1
        cur = cur.parent_id ? flat.find((f) => f.id === cur!.parent_id) : undefined
      }
      return depth
    }
    if (depthOf(targetFolderId) >= 2) return false
    return !findFolderById(folders, activeFolderId)?.children?.length
  }, [flat, folders])

  const handleDragMove = useCallback(() => {
    const id = overIdRef.current
    const overRect = overRectRef.current
    const clientY = clientYRef.current
    setOverId(id)
    if (!id || !overRect || clientY === null) { setDropPosition(null); return }
    const relativeYPercent = (clientY - overRect.top) / overRect.height
    if (relativeYPercent < 0.25) setDropPosition('before')
    else if (relativeYPercent > 0.75) setDropPosition('after')
    else setDropPosition(activeIdRef.current && canDropInside(activeIdRef.current, id) ? 'inside' : null)
  }, [canDropInside])

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

    const dragged = flat.find((f) => f.id === active.id)
    const target = flat.find((f) => f.id === over.id)
    if (!dragged || !target) return

    const draggedNode = findFolderById(folders, dragged.id)
    const descendantIds = draggedNode ? getFolderWithDescendantIds(draggedNode) : [dragged.id]
    if (descendantIds.includes(target.id)) return

    if (currentDropPosition === 'inside') {
      // 权威复核:非法 inside 在拖拽中已不显示指示,这里兜住边界时序。
      if (!canDropInside(dragged.id, target.id)) return
      onMoveFolder(dragged.id, target.id, 0)
      return
    }

    const newParentId = target.parent_id ?? null
    const siblings = flat.filter((f) => (f.parent_id ?? null) === newParentId)
    let targetIndex = siblings.findIndex((f) => f.id === target.id)
    if (currentDropPosition === 'after') targetIndex++
    const currentIndex = siblings.findIndex((f) => f.id === dragged.id)
    if (currentIndex !== -1 && currentIndex < targetIndex) targetIndex--
    onMoveFolder(dragged.id, newParentId, Math.max(0, targetIndex))
  }, [dropPosition, flat, folders, onMoveFolder, detachPointerListener, canDropInside])

  const handleDragCancel = useCallback(() => {
    detachPointerListener()
    setActiveId(null)
    setOverId(null)
    setDropPosition(null)
    overIdRef.current = null
    overRectRef.current = null
    clientYRef.current = null
  }, [detachPointerListener])

  const activeFolder = activeId ? findFolderById(folders, activeId) ?? null : null

  return {
    sensors,
    collisionDetection,
    activeId,
    activeFolder,
    overId,
    dropPosition,
    handleDragStart,
    handleDragMove,
    handleDragEnd,
    handleDragCancel,
  }
}
