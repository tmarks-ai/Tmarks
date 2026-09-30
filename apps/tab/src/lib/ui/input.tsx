import type { InputHTMLAttributes, ReactElement } from 'react'
import { cn } from './cn'

/** 统一文本输入类:rounded-lg 控件档 + px-3 py-2 + focus ring。供 options 各 section 的 input/textarea 复用。 */
export const inputClass =
  'rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:ring-2 focus:ring-ring disabled:opacity-50'

/** 统一文本输入组件(套 inputClass)。textarea 仍用 inputClass 直接拼 className(rows/resize 等)。 */
export function Input({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>): ReactElement {
  return <input className={cn(inputClass, className)} {...rest} />
}
