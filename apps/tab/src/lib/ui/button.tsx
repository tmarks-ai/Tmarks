import type { ButtonHTMLAttributes, ReactElement, ReactNode } from 'react'
import { Loader2 } from 'lucide-react'
import { cn } from './cn'

/**
 * 统一按钮:变体 + 尺寸 + loading(slot 自带 Loader2)。替换 popup/options 里散装的
 * `rounded bg-primary px-3 ...` / `rounded border border-border ...` 等手写按钮类,
 * 统一 hover/disabled/focus 表现。默认 type="button"(表单提交场景传 type="submit")。
 * 命名与 web 端 kit 对齐:`default` 为 `primary` 与 `md` 的别名(两端共用一套语义,
 * web Button 的 default/destructive/outline/secondary/ghost/link 对应本端的
 * primary/destructive/outline/secondary/ghost)。
 */
type ButtonVariant = 'default' | 'primary' | 'secondary' | 'outline' | 'ghost' | 'destructive' | 'success'
type ButtonSize = 'default' | 'sm' | 'md' | 'icon'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  loading?: boolean
  leading?: ReactNode
}

const VARIANTS: Record<ButtonVariant, string> = {
  default: 'bg-primary text-primary-foreground hover:bg-primary/90',
  primary: 'bg-primary text-primary-foreground hover:bg-primary/90',
  secondary: 'bg-secondary text-secondary-foreground hover:bg-secondary/80',
  outline: 'border border-border bg-background hover:bg-muted',
  ghost: 'text-foreground hover:bg-muted',
  destructive: 'bg-destructive text-destructive-foreground hover:bg-destructive/90',
  success: 'bg-success text-success-foreground hover:bg-success/90',
}

const SIZES: Record<ButtonSize, string> = {
  default: 'h-9 px-3 text-sm',
  sm: 'h-7 px-2.5 text-xs',
  md: 'h-9 px-3 text-sm',
  icon: 'h-8 w-8 p-0',
}

export function Button({
  variant = 'outline',
  size = 'md',
  loading = false,
  leading,
  className,
  children,
  disabled,
  type = 'button',
  ...rest
}: ButtonProps): ReactElement {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      className={cn(
        'inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition-colors disabled:opacity-50 disabled:pointer-events-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      {...rest}
    >
      {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : leading}
      {children}
    </button>
  )
}
