import { useEffect, useRef } from 'react'
import { QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter } from 'react-router-dom'
import { AppRouter } from '@/routes'
import { useAuthStore } from '@/stores/authStore'
import { useToastStore } from '@/stores/toastStore'
import { ToastContainer } from '@/components/common/Toast'
import { ErrorBoundary } from '@/components/common/ErrorBoundary'
import { queryClient } from '@/lib/query-client'

function App() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)
  const accessToken = useAuthStore((s) => s.accessToken)
  const clearAuth = useAuthStore((s) => s.clearAuth)
  const refreshAccessToken = useAuthStore((s) => s.refreshAccessToken)
  const userId = useAuthStore((s) => s.user?.id) ?? null
  const toasts = useToastStore((s) => s.toasts)
  const removeToast = useToastStore((s) => s.removeToast)
  const previousUserId = useRef<string | null | undefined>(undefined)

  // 启动时若标记已认证但 access token 缺失,用 HttpOnly cookie 里的 refresh
  // token 静默恢复会话;cookie 无效则回到未登录状态。
  useEffect(() => {
    if (isAuthenticated && !accessToken) {
      refreshAccessToken().catch(() => clearAuth())
    }
  }, [isAuthenticated, accessToken, refreshAccessToken, clearAuth])

  // 用户切换时清空缓存(避免上个用户的敏感数据残留)
  useEffect(() => {
    if (previousUserId.current === undefined) {
      previousUserId.current = userId
      return
    }
    if (previousUserId.current !== userId) {
      queryClient.clear()
      previousUserId.current = userId
    }
  }, [userId])

  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <AppRouter />
          <ToastContainer toasts={toasts} onClose={removeToast} />
        </BrowserRouter>
      </QueryClientProvider>
    </ErrorBoundary>
  )
}

export default App
