import { memo } from 'react'
import type { TagFilterDTO } from '@tmarks/contracts'
import { cn } from '@/lib/utils'

interface TagItemProps {
  tag: TagFilterDTO
  isSelected: boolean
  isRelated: boolean
  hasSelection: boolean
  /** 传 tagId 而非逐行闭包:父级保持引用稳定,memo 才能在键击时跳过整列重渲染。 */
  onToggle: (tagId: string) => void
}

/** 标签项:已选/相关/默认三态着色 + 关联书签数。紧凑 pill 布局,flex-wrap 自动换行。
 * memo:标签量可达数千,侧栏搜索每键击会重渲染父级;props 恒等时行级跳过。 */
export const TagItem = memo(function TagItem({ tag, isSelected, isRelated, hasSelection, onToggle }: TagItemProps) {
  const stateClasses = isSelected
    ? 'border border-primary bg-primary text-primary-foreground ring-1 ring-primary/40'
    : isRelated
      ? 'border border-accent/50 bg-accent/10 text-accent-foreground ring-1 ring-accent/20'
      : hasSelection
        ? 'border border-transparent bg-muted/80 text-muted-foreground opacity-70'
        : 'border border-border bg-card hover:border-primary/50 hover:bg-muted/40'

  return (
    <button
      type="button"
      className={cn(`inline-flex max-w-full items-center gap-1 rounded-md px-2 py-1 text-left transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 ${stateClasses}`)}
      onClick={() => onToggle(tag.id)}
      aria-pressed={isSelected}
    >
      {tag.color && !isSelected && (
        <span className="h-2 w-2 flex-shrink-0 rounded-full" style={{ backgroundColor: tag.color }} aria-hidden />
      )}
      <span className={cn(`max-w-28 truncate text-xs ${isSelected ? 'font-semibold' : 'font-medium'}`)}>
        {tag.name}
      </span>
      <span className="flex-shrink-0 text-[10px] opacity-60">
        {tag.bookmark_count}
      </span>
    </button>
  )
})
