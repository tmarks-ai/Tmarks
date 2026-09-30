import { ErrorMessage } from './ErrorMessage'
import { SuccessMessage } from './SuccessMessage'
import { LoadingMessage } from './LoadingMessage'

interface Props {
  error: string | null
  success: string | null
  loading: string | null
  onDismissError: () => void
  onDismissSuccess: () => void
  onClearLoading?: () => void
  onRetry?: () => void
}

/** 顶部消息层(固定 --tab-z-message,锚定在 header 之下):错误/加载/成功三态栈,
 *  由 Popup 持有消息状态,各视图卡内渲染本组件。此前 top-0 盖在 header 上,
 *  提示存续期间(错误 2s/成功 3s)会挡住"保存/采集"按钮——下移一个 header 高度避让。 */
export function MessageLayer({ error, success, loading, onDismissError, onDismissSuccess, onClearLoading, onRetry }: Props) {
  return (
    <div className="pointer-events-none fixed left-0 right-0 top-[var(--tab-popup-header-h)] z-[var(--tab-z-message)] space-y-2 px-4 pt-2">
      {error && <div className="pointer-events-auto"><ErrorMessage message={error} onDismiss={onDismissError} onRetry={onRetry} /></div>}
      {loading && <div className="pointer-events-auto"><LoadingMessage message={loading} onDismiss={onClearLoading} /></div>}
      {success && <div className="pointer-events-auto"><SuccessMessage message={success} onDismiss={onDismissSuccess} /></div>}
    </div>
  )
}

export type Notify = (level: 'error' | 'success' | 'loading', text: string) => void
