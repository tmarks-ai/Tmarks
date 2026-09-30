import { useEffect, useState } from 'react'
import type { TabGroupDTO } from '@tmarks/contracts'
import type { PaginationFooterProps } from '@/components/common/PaginationFooter'

interface TabGroupsPaginationOptions {
  pageSize: number
  /** 搜索/排序/选中文件夹变化时重置到第一页(字符串化保证引用稳定)。 */
  resetKey: string
  onPageSizeChange: (size: number) => void
}

interface TabGroupsPagination {
  pagedGroups: TabGroupDTO[]
  pagination?: PaginationFooterProps
}

/**
 * 标签页收纳的客户端分页:仅在平铺视图(搜索/进入文件夹)下切页,根视图按文件夹
 * 树渲染保持全量。分页控件复用书签页的 PaginationFooter 与共享 page_size 偏好。
 */
export function useTabGroupsPagination(
  visibleGroups: TabGroupDTO[],
  layoutMode: 'root' | 'flat',
  { pageSize, resetKey, onPageSizeChange }: TabGroupsPaginationOptions,
): TabGroupsPagination {
  const [pageIndex, setPageIndex] = useState(0)
  useEffect(() => {
    setPageIndex(0)
  }, [resetKey, pageSize])

  const isFlat = layoutMode === 'flat'
  const totalPages = Math.max(1, Math.ceil(visibleGroups.length / pageSize))
  const safeIndex = isFlat ? Math.min(pageIndex, totalPages - 1) : 0
  const pagedGroups = isFlat
    ? visibleGroups.slice(safeIndex * pageSize, safeIndex * pageSize + pageSize)
    : visibleGroups

  const pagination: PaginationFooterProps | undefined = isFlat
    ? {
        currentPage: safeIndex + 1,
        currentCount: pagedGroups.length,
        hasPreviousPage: safeIndex > 0,
        hasNextPage: (safeIndex + 1) * pageSize < visibleGroups.length,
        pageSize,
        onPreviousPage: () => setPageIndex((i) => Math.max(0, i - 1)),
        onNextPage: () => setPageIndex((i) => i + 1),
        onPageSizeChange,
      }
    : undefined

  return { pagedGroups, pagination }
}