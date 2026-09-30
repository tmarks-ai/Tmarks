import { useEffect } from 'react'
import { cn } from '@/lib/utils'
import { useTranslation } from 'react-i18next'
import { X, CheckCircle, AlertCircle, Info, AlertTriangle } from 'lucide-react'
import { Z_INDEX } from '@/lib/constants/z-index'
import type { ToastProps } from '@/shared/toast'

// 兼容性再导出:历史代码从 components/common/Toast 引入类型,新代码请直接引用 @/shared/toast。
export type { ToastProps, ToastType } from '@/shared/toast'

const ICONS = { success: CheckCircle, error: AlertCircle, info: Info, warning: AlertTriangle }
const COLORS = {
  success: { border: 'border-success', icon: 'text-success', bg: 'bg-success/10' },
  error: { border: 'border-destructive', icon: 'text-destructive', bg: 'bg-destructive/10' },
  info: { border: 'border-primary', icon: 'text-primary', bg: 'bg-primary/10' },
  warning: { border: 'border-warning', icon: 'text-warning', bg: 'bg-warning/10' },
}

export function Toast({ id, type, message, duration = 3000, onClose }: ToastProps) {
  const { t } = useTranslation('common')
  const Icon = ICONS[type]
  const colors = COLORS[type]

  useEffect(() => {
    if (duration > 0) {
      const timer = setTimeout(() => onClose(id), duration)
      return () => clearTimeout(timer)
    }
  }, [id, duration, onClose])

  return (
    <div role={type === 'error' ? 'alert' : 'status'} className={cn(`relative flex items-start gap-3 p-4 rounded-lg border-2 shadow-lg bg-card ${colors.border} min-w-0 max-w-[calc(100vw-2rem)] sm:max-w-md animate-slide-in backdrop-blur-sm`)}>
      <div className={cn(`absolute inset-0 rounded-lg ${colors.bg} pointer-events-none`)} />
      <Icon className={cn(`relative w-5 h-5 ${colors.icon} flex-shrink-0 mt-0.5`)} />
      <p className="relative flex-1 text-sm font-medium text-foreground">{message}</p>
      <button onClick={() => onClose(id)} className={cn(`relative ${colors.icon} hover:opacity-70 transition-opacity flex-shrink-0`)} aria-label={t('button.close')}>
        <X className="w-5 h-5" />
      </button>
    </div>
  )
}

export function ToastContainer({ toasts, onClose }: { toasts: ToastProps[]; onClose: (id: string) => void }) {
  return (
    <div aria-live="polite" className="fixed top-4 right-4 flex flex-col gap-2 z-layer-toast" style={{ zIndex: Z_INDEX.TOAST }}>
      {toasts.map((toast) => (
        <Toast key={toast.id} {...toast} onClose={onClose} />
      ))}
    </div>
  )
}
