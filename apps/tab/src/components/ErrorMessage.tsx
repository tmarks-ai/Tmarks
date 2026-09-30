import { useEffect } from 'react'
import { AlertCircle, X } from 'lucide-react'
import { useI18n } from '../lib/i18n'

interface Props {
  message: string
  onDismiss: () => void
  onRetry?: () => void
  /** 自动消失(ms),默认 2000;传 0 关闭。 */
  duration?: number
}

/** 顶部错误提示(danger 色,自动 2s 消失),移植自旧版 ErrorMessage。 */
export function ErrorMessage({ message, onDismiss, onRetry, duration = 2000 }: Props) {
  const { t } = useI18n()
  useEffect(() => {
    if (duration <= 0) return
    const id = setTimeout(onDismiss, duration)
    return () => clearTimeout(id)
  }, [duration, onDismiss, message])
  return (
    <div className="flex items-start gap-2.5 rounded-lg border border-[var(--tab-message-danger-border)] bg-[var(--tab-message-danger-bg)] p-3 text-[var(--tab-message-danger-icon)] shadow-lg animate-in slide-in-from-top-5 fade-in duration-300">
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[var(--tab-message-danger-icon-bg)]"><AlertCircle className="h-4 w-4" /></span>
      <p className="flex-1 self-center text-xs font-medium leading-snug">{message}</p>
      {onRetry && <button type="button" onClick={onRetry} className="self-center rounded px-2 py-1 text-xs font-medium underline hover:opacity-80">{t('btn.retry')}</button>}
      <button type="button" onClick={onDismiss} className="self-center rounded p-0.5 hover:opacity-70" aria-label="dismiss"><X className="h-3.5 w-3.5" /></button>
    </div>
  )
}
