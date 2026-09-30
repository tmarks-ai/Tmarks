import { useEffect } from 'react'
import { CheckCircle2, X } from 'lucide-react'

interface Props {
  message: string
  onDismiss: () => void
  /** 自动消失(ms),默认 3000;传 0 关闭。 */
  duration?: number
}

/** 顶部成功提示(success 色,自动 3s 消失),移植自旧版 SuccessMessage。 */
export function SuccessMessage({ message, onDismiss, duration = 3000 }: Props) {
  useEffect(() => {
    if (duration <= 0) return
    const id = setTimeout(onDismiss, duration)
    return () => clearTimeout(id)
  }, [duration, onDismiss, message])
  return (
    <div className="flex items-start gap-2.5 rounded-lg border border-[var(--tab-message-success-border)] bg-[var(--tab-message-success-bg)] p-3 text-[var(--tab-message-success-icon)] shadow-lg animate-in slide-in-from-top-5 fade-in duration-300">
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[var(--tab-message-success-icon-bg)]"><CheckCircle2 className="h-4 w-4" /></span>
      <p className="flex-1 self-center text-xs font-medium leading-snug">{message}</p>
      <button type="button" onClick={onDismiss} className="self-center rounded p-0.5 hover:opacity-70" aria-label="dismiss"><X className="h-3.5 w-3.5" /></button>
    </div>
  )
}
