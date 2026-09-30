import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

interface EmptyStateProps {
  icon: LucideIcon
  title: string
  description?: string
  action?: React.ReactNode
  className?: string
}

/** 通用空态:图标 + 标题 + 可选说明 + 可选操作,书签/标签组/搜索无果共用一套视觉。 */
export function EmptyState({ icon: Icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div className={cn('py-12 text-center', className)}>
      <Icon className="mx-auto mb-4 h-16 w-16 text-muted-foreground opacity-20" />
      <p className="text-lg font-medium text-muted-foreground">{title}</p>
      {description && <p className="mt-2 text-sm text-muted-foreground">{description}</p>}
      {action && <div className="mt-6 flex justify-center">{action}</div>}
    </div>
  )
}