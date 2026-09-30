import { useEffect, useRef, useState } from 'react'
import { useI18n } from '../i18n'
import { Button } from './button'
import { useDialogA11y } from './dialog-a11y'

interface ConfirmOptions {
  title?: string
  message: string
  confirmText?: string
  cancelText?: string
  danger?: boolean
}

interface ConfirmState extends ConfirmOptions {
  open: boolean
}

let resolver: ((v: boolean) => void) | null = null
let setter: ((s: ConfirmState) => void) | null = null

const CLOSED: ConfirmState = { open: false, message: '' }

/**
 * 编程式确认弹窗:任意位置 `await confirmDialog({...})` 替换 window.confirm。
 * 需在 popup/options 根各挂一个 <ConfirmRoot /> 接管渲染。模块级单例足够单窗口扩展使用。
 * 视觉复刻旧版 ConfirmModal:z-[var(--tab-z-confirm)] 蒙层 + rounded-2xl 卡 + 顶部渐变条 + danger/primary 按钮。
 */
export function confirmDialog(options: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    // 新弹窗顶掉旧弹窗时,旧 Promise 以 false 收尾而非永远悬挂泄漏。
    resolver?.(false)
    resolver = resolve
    setter?.({ ...options, open: true })
  })
}

export function ConfirmRoot() {
  const { t } = useI18n()
  const [state, set] = useState<ConfirmState>(CLOSED)
  const cardRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setter = set
    return () => {
      setter = null
    }
  }, [])

  const handle = (v: boolean) => {
    set(CLOSED)
    resolver?.(v)
    resolver = null
  }

  // ESC 取消 + 焦点圈 + 关闭时焦回触发者(蒙层点击关闭为既有行为)。
  useDialogA11y(true, cardRef, () => handle(false))

  if (!state.open) return null

  return (
    <div className="fixed inset-0 z-[var(--tab-z-confirm)] flex items-center justify-center bg-[var(--tab-options-modal-overlay)] p-4 backdrop-blur-sm" onClick={() => handle(false)}>
      <div ref={cardRef} className="relative w-full max-w-md overflow-hidden rounded-2xl border border-[var(--tab-options-modal-border)] bg-[var(--tab-options-modal-bg)] shadow-2xl animate-in fade-in zoom-in-95 duration-150" onClick={(event) => event.stopPropagation()} role="alertdialog" aria-modal="true" aria-label={state.title}>
        <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-[var(--tab-options-modal-topbar-from)] via-[var(--tab-options-modal-topbar-via)] to-[var(--tab-options-modal-topbar-to)]" />
        <div className="space-y-4 p-6 pt-8">
          <div>
            {state.title && <h3 className="text-lg font-semibold text-[var(--tab-options-title)]">{state.title}</h3>}
            <p className="mt-1 text-sm text-[var(--tab-options-text)]">{state.message}</p>
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <Button variant="outline" onClick={() => handle(false)}>{state.cancelText ?? t('btn.cancel')}</Button>
            <Button
              variant="primary"
              onClick={() => handle(true)}
              className={state.danger ? 'bg-[var(--tab-options-danger-bg)] text-[var(--tab-options-danger-text)] hover:bg-[var(--tab-options-danger-hover-bg)]' : ''}
            >
              {state.confirmText ?? t('btn.confirm')}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
