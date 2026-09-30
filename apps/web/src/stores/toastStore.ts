import { create } from 'zustand'
import type { ToastType, ToastProps } from '@/shared/toast'

interface ToastState {
  toasts: ToastProps[]
  addToast: (type: ToastType, message: string, duration?: number) => void
  removeToast: (id: string) => void
  success: (message: string, duration?: number) => void
  error: (message: string, duration?: number) => void
  info: (message: string, duration?: number) => void
  warning: (message: string, duration?: number) => void
}

export const useToastStore = create<ToastState>((set) => ({
  toasts: [],

  addToast: (type, message, duration = 3000) => {
    const id = `toast-${Date.now()}-${Math.random()}`
    set((state) => ({
      toasts: [
        ...state.toasts,
        { id, type, message, duration, onClose: (id: string) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })) },
      ],
    }))
  },

  removeToast: (id) => set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) })),

  success: (message, duration) => useToastStore.getState().addToast('success', message, duration),
  error: (message, duration) => useToastStore.getState().addToast('error', message, duration),
  info: (message, duration) => useToastStore.getState().addToast('info', message, duration),
  warning: (message, duration) => useToastStore.getState().addToast('warning', message, duration),
}))
