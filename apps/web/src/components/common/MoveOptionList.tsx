import { cn } from '@/lib/utils'
import type { FlatMoveTarget } from '@/lib/folder-move'

interface MoveOptionListProps {
  options: FlatMoveTarget[]
  selectedId: string | null
  emptyLabel: string
  onSelect: (id: string | null) => void
}

/**
 * 移动对话框的目标列表:统一的选择态样式、深度缩进与空态。
 * 根目录选项由调用方以 id 为空串的 option 传入(onSelect 会归一为 null)。
 */
export function MoveOptionList({ options, selectedId, emptyLabel, onSelect }: MoveOptionListProps) {
  return (
    <div className="tmarks-scrollbar max-h-72 space-y-1 overflow-y-auto">
      {options.length === 0 ? (
        <p className="px-3 py-2 text-sm text-muted-foreground">{emptyLabel}</p>
      ) : (
        options.map((opt) => {
          const value = opt.id || null
          const active = selectedId === value
          return (
            <button
              key={opt.id || '__root__'}
              type="button"
              onClick={() => onSelect(value)}
              style={opt.depth ? { paddingLeft: `${0.75 + opt.depth * 1.25}rem` } : undefined}
              className={cn(
                'flex w-full items-center rounded-lg px-3 py-2 text-left text-sm',
                active ? 'bg-primary/10 text-primary' : 'hover:bg-muted',
              )}
            >
              {opt.label}
            </button>
          )
        })
      )}
    </div>
  )
}