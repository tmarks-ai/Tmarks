import type { ReactNode } from 'react'

interface FieldProps {
  label: string
  hint?: string
  htmlFor?: string
  /** 横排时(标签与控件同行)用;默认纵排(标签在上)。 */
  inline?: boolean
  className?: string
  children: ReactNode
}

/** 统一标签+控件+提示(可选)的字段外壳。替代各 section 散写的 <label className="text-xs">/text-sm font-medium 模式。 */
export function Field({ label, hint, htmlFor, inline, className, children }: FieldProps): React.ReactElement {
  const body = (
    <>
      <span className={inline ? 'text-sm font-medium text-foreground' : 'block text-sm font-medium text-foreground'}>{label}</span>
      {inline ? <span className="ml-2">{children}</span> : <div className="mt-1.5">{children}</div>}
      {hint ? <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{hint}</p> : null}
    </>
  )
  if (inline) {
    return (
      <div className={className}>
        <div className="flex flex-wrap items-center gap-2">{body}</div>
      </div>
    )
  }
  return (
    <label htmlFor={htmlFor} className={className}>
      {body}
    </label>
  )
}
