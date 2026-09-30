import { useEffect, useRef, type RefObject } from 'react'

/**
 * 自绘弹窗的键盘可达性(Radix Dialog 的自绘替代配套):ESC 关闭、焦点圈
 * (打开时移焦入卡、Tab 在卡内循环、关闭时把焦点还给触发者)。本仓库的
 * 自绘弹窗——popup 的 CollectionOptionsDialog、lib/ui/confirm 的
 * ConfirmRoot——统一挂载本钩子;蒙层点击关闭仍由调用方自行实现。
 *
 * 已知取舍:卡内含 Radix Select 时,下拉展开状态按 ESC 会同时关闭下拉
 * 与弹窗(Radix 在 document 上监听,不阻止本监听器)。罕见路径,接受。
 */
export function useDialogA11y(active: boolean, ref: RefObject<HTMLElement | null>, onClose: () => void): void {
  // onClose 以 ref 持有:内联闭包每次渲染变身份,而 effect 只应随 active 挂卸,
  // 否则每次渲染重跑 cleanup 会把焦点错误地还给触发者。
  const closeRef = useRef(onClose)
  closeRef.current = onClose

  useEffect(() => {
    if (!active) return
    const node = ref.current
    if (!node) return
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null

    const focusables = (): HTMLElement[] =>
      [...node.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')]
        .filter((el) => !el.hasAttribute('disabled'))
    ;(focusables()[0] ?? node).focus()

    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') { closeRef.current(); return }
      if (e.key !== 'Tab') return
      const list = focusables()
      if (list.length === 0) { e.preventDefault(); return }
      // 焦点已落在卡外(初始未聚焦成功等场景):拉回卡内首元素。
      if (!node.contains(document.activeElement)) { e.preventDefault(); list[0]!.focus(); return }
      const first = list[0]!
      const last = list[list.length - 1]!
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
    }

    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      previous?.focus()
    }
  }, [active, ref])
}
