import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

/** 统一的区块标题:h2 + 可选灰色说明 + 可选图标(页面级 h1 由 ShellHeader 提供)。 */
export function SectionHeader({ title, description, icon: Icon }: {
  title: string
  description?: string
  icon?: LucideIcon
}): React.ReactElement {
  return (
    <div className="space-y-1">
      <h2 className="flex items-center gap-2 text-lg font-semibold">
        {Icon && <Icon className="h-5 w-5 text-muted-foreground" />}
        {title}
      </h2>
      {description && <p className="text-sm text-muted-foreground">{description}</p>}
    </div>
  )
}

/** 统一的设置卡片:头部「图标+标题+说明」+ 内容 + 可选操作区。 */
export function SettingGroup({ icon: Icon, title, description, children, actions, className }: {
  icon?: LucideIcon
  title?: string
  description?: string
  children: React.ReactNode
  actions?: React.ReactNode
  className?: string
}): React.ReactElement {
  const hasHead = Boolean(title || description || actions)
  return (
    <div className={cn('rounded-xl border border-border/60 bg-muted/20 p-4 sm:p-5', className)}>
      {hasHead && (
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-0.5">
            {title && (
              <h3 className="flex items-center gap-2 text-sm font-semibold">
                {Icon && <Icon className="h-4 w-4 text-muted-foreground" />}
                {title}
              </h3>
            )}
            {description && <p className="text-xs leading-relaxed text-muted-foreground">{description}</p>}
          </div>
          {actions && <div className="shrink-0">{actions}</div>}
        </div>
      )}
      <div className={cn(hasHead && 'mt-3')}>{children}</div>
    </div>
  )
}

/** 统一的自动保存反馈(成功/失败/空闲)。 */
export function SaveFeedback({ update, t }: {
  update: { isSuccess: boolean; isError: boolean }
  t: (key: string) => string
}): React.ReactElement | null {
  if (update.isSuccess) return <p className="text-sm text-primary">{t('message.saveSuccess')}</p>
  if (update.isError) return <p className="text-sm text-destructive">{t('message.saveFailed')}</p>
  return null
}

/** 统一的分段开关(2~3 选一),替代各处风格不一的按钮组。 */
export function SegmentToggle<T extends string>({ value, options, onChange }: {
  value: T
  options: Array<{ value: T; label: string; icon?: LucideIcon }>
  onChange: (value: T) => void
}): React.ReactElement {
  return (
    <div className="inline-flex flex-wrap gap-1 rounded-lg border border-border/40 bg-muted/30 p-1">
      {options.map((o) => {
        const active = o.value === value
        const OIcon = o.icon
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            aria-pressed={active}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
              active
                ? 'bg-primary text-primary-foreground shadow-sm'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground',
            )}
          >
            {OIcon && <OIcon className="h-4 w-4" />}
            {o.label}
          </button>
        )
      })}
    </div>
  )
}
