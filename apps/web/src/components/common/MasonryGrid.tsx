import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'

interface MasonryGridProps {
  children: ReactNode
  /** Minimum column width in px before adding another column */
  minColumnWidth?: number
  /** Gap between columns and items in px */
  gap?: number
  /** Minimum number of columns */
  minCols?: number
  /** Maximum number of columns */
  maxCols?: number
  /** Tailwind class for item vertical spacing (e.g. "mb-3") */
  itemSpacing?: string
}

/**
 * Masonry grid with "shortest column first" distribution.
 *
 * - First render: items placed round-robin (for measurement only)
 * - useLayoutEffect measures each item's real height (sorted by original
 *   index via data-masonry-index to avoid DOM-order mismatch)
 * - Assigns each item to the column with the shortest current height
 * - When all items are the same height → fills left-to-right, row by row
 * - When items have different heights → true masonry (no vertical gaps)
 */
export function MasonryGrid({
  children,
  minColumnWidth = 280,
  gap = 12,
  minCols = 1,
  maxCols = 3,
  itemSpacing = 'mb-3',
}: MasonryGridProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [columns, setColumns] = useState(minCols)
  const [assignments, setAssignments] = useState<number[]>([])

  const items = Array.isArray(children) ? children : [children]

  // Responsive column count via ResizeObserver
  useLayoutEffect(() => {
    const el = containerRef.current
    if (!el) return
    const update = () => {
      const width = el.offsetWidth
      let cols = minCols
      for (let i = minCols; i <= maxCols; i++) {
        if (width >= i * minColumnWidth + (i - 1) * gap) cols = i
        else break
      }
      setColumns(cols)
    }
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [minColumnWidth, gap, minCols, maxCols])

  // Measure heights and assign items to shortest column
  useLayoutEffect(() => {
    const container = containerRef.current
    if (!container) return
    const grid = container.firstElementChild as HTMLElement | null
    if (!grid) return

    // Query all masonry items and sort by original index to preserve item order
    const itemEls = Array.from(grid.querySelectorAll('[data-masonry-item]')) as HTMLElement[]
    itemEls.sort((a, b) => Number(a.dataset.masonryIndex) - Number(b.dataset.masonryIndex))
    if (itemEls.length === 0) return

    const heights = itemEls.map((el) => el.getBoundingClientRect().height)
    const colHeights = new Array(columns).fill(0)
    const newAssignments: number[] = []
    for (let i = 0; i < heights.length; i++) {
      // Find shortest column (first one wins ties → left-to-right when equal)
      let col = 0
      for (let c = 1; c < columns; c++) {
        if (colHeights[c]! < colHeights[col]!) col = c
      }
      newAssignments.push(col)
      colHeights[col] += heights[i]! + gap
    }
    setAssignments(newAssignments)
  }, [items.length, columns, gap])

  // Build column arrays
  const cols: ReactNode[][] = Array.from({ length: columns }, () => [])
  items.forEach((item, i) => {
    // Use computed assignment only if it exists AND is within current column range
    // (columns may have changed since last assignment, leaving stale out-of-range indices)
    const assigned = assignments[i]
    const col = assignments.length === items.length && assigned != null && assigned < columns
      ? assigned
      : i % columns
    cols[col]!.push(
      <div key={i} className={itemSpacing} data-masonry-item data-masonry-index={i}>
        {item}
      </div>,
    )
  })

  return (
    <div ref={containerRef} className="w-full min-w-0">
      {columns > 0 && (
        <div
          className="w-full min-w-0"
          style={{
            display: 'grid',
            gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
            gap: `${gap}px`,
          }}
        >
          {cols.map((col, colIndex) => (
            <div key={`col-${colIndex}`} className="min-w-0">
              {col}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
