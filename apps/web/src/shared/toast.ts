/** Toast 消息类型:store 与 UI 共享,避免 store 反向依赖 components。 */
export type ToastType = 'success' | 'error' | 'info' | 'warning'

export interface ToastProps {
  id: string
  type: ToastType
  message: string
  duration?: number
  onClose: (id: string) => void
}