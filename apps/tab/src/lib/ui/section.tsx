import type { HTMLAttributes, ReactElement, ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import { cn } from './cn'

/**
 * 段内子块头:扁平小标题(muted 小图标 + sm 加粗标题 + xs 描述)。
 * 对齐 web 端 SettingGroup 头;同一 Section 卡内多块用 divide-y 分隔,各块以此头起。
 */
export function BlockHeader({ icon: Icon, title, description }: { icon?: LucideIcon; title: string; description?: string }): ReactElement {
  return (
    <div className="space-y-0.5">
      <h3 className="flex items-center gap-2 text-sm font-semibold text-[var(--tab-options-title)]">
        {Icon ? <Icon className="h-4 w-4 text-muted-foreground" /> : null}
        {title}
      </h3>
      {description ? <p className="text-xs leading-relaxed text-muted-foreground">{description}</p> : null}
    </div>
  )
}

/** 块内子标题:sm 加粗 + 可选操作槽(如"添加连接/导入"按钮)。统一块内"小标题+操作"模式。 */
export function SubHeader({ title, action }: { title: string; action?: ReactNode }): ReactElement {
  return (
    <div className="flex items-center justify-between gap-2">
      <h3 className="text-sm font-semibold text-[var(--tab-options-title)]">{title}</h3>
      {action}
    </div>
  )
}

/**
 * options 段容器:扁平内容卡(rounded-2xl + 玻璃面 + 阴影),无渐变顶条。
 * 直接子块自动 py-5,首块顶/末块底归零(由卡片自身 padding 接管),
 * 使 divide-y 分割线两侧各有呼吸;单块 tab 则 padding 全由卡片提供。
 */
export function Section({ className, ...rest }: HTMLAttributes<HTMLDivElement>): ReactElement {
  return (
    <section className={cn(
      'rounded-2xl border border-[var(--tab-options-card-border)] bg-[var(--tab-options-card-bg)] p-5 shadow-sm backdrop-blur sm:p-6',
      '[&>*]:py-5 [&>*:first-child]:pt-0 [&>*:last-child]:pb-0',
      className,
    )} {...rest} />
  )
}
