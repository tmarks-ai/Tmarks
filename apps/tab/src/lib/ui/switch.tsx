import { cn } from './cn'
import type { ReactElement } from 'react'

interface SwitchProps {
  on: boolean
  onClick: () => void
  /** 可访问性标签,作用于 role=switch。仅设置它不会渲染可见文本。 */
  label?: string
  /** 可见文本(渲染在开关右侧);传入后整块区域(含文本)均可点击切换。 */
  text?: string
}

/**
 * 统一开关:track + thumb,品牌色激活态。从 PreferencesSection 抽出供复用。
 * 注意:`label` 只进 aria-label——单独使用时明眼用户看不到任何说明文字,
 * 需要可见标签的场景请传 `text`(或用下面的 Row)。
 */
export function Switch({ on, onClick, label, text }: SwitchProps): ReactElement {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={onClick}
      className={cn(`inline-flex cursor-pointer items-center gap-1.5 rounded-lg bg-transparent focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--tab-options-button-primary-bg)] focus-visible:ring-offset-2`)}
    >
      <span className={cn(`relative inline-flex h-6 w-11 shrink-0 rounded-full border-2 border-transparent transition-colors duration-200 ${on ? 'bg-[var(--tab-options-button-primary-bg)]' : 'bg-[var(--tab-options-switch-track-off)]'}`)}>
        <span className={cn(`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-[var(--tab-options-switch-thumb)] shadow ring-0 transition duration-200 ${on ? 'translate-x-5' : 'translate-x-0'}`)} />
      </span>
      {text ? <span className="text-sm text-foreground">{text}</span> : null}
    </button>
  )
}

interface RowProps {
  title: string
  hint?: string
  on: boolean
  onClick: () => void
}

/** 统一偏好行:标题 + hint + 开关,行内 border-t 分隔。 */
export function Row({ title, hint, on, onClick }: RowProps): ReactElement {
  return (
    <div className="flex items-center justify-between border-t border-[var(--tab-options-card-border)] py-3">
      <div className="min-w-0">
        <span className="block text-sm font-medium text-foreground">{title}</span>
        {hint ? <span className="mt-1 block text-xs text-muted-foreground">{hint}</span> : null}
      </div>
      <Switch on={on} onClick={onClick} label={title} />
    </div>
  )
}
