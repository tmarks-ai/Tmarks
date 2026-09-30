import { Loader2 } from 'lucide-react'

interface Props {
  message: string
  onDismiss?: () => void
}

/** 顶部加载提示(info 色,旋转圈 + 三点跳动),需手动清除(非自动消失),移植自旧版 LoadingMessage。 */
export function LoadingMessage({ message, onDismiss }: Props) {
  return (
    <div className="flex items-center gap-2.5 rounded-lg border border-[var(--tab-message-info-border)] bg-[var(--tab-message-info-bg)] p-3 text-[var(--tab-message-info-icon)] shadow-lg animate-in slide-in-from-top-5 fade-in duration-300">
      <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
      <p className="flex-1 self-center text-xs font-medium leading-snug">{message}</p>
      <span className="flex shrink-0 items-center gap-0.5 self-center">
        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-current [animation-delay:0ms]" />
        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-current [animation-delay:150ms]" />
        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-current [animation-delay:300ms]" />
      </span>
      {onDismiss && <button type="button" onClick={onDismiss} className="self-center rounded p-0.5 hover:opacity-70" aria-label="dismiss">✕</button>}
    </div>
  )
}
