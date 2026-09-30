import { lazy, Suspense } from 'react'
import { useTranslation } from 'react-i18next'
import { Routes, Route, Navigate } from 'react-router-dom'
import { AppShell } from '@/components/layout/AppShell'
import { FullScreenAppShell } from '@/components/layout/FullScreenAppShell'
import { PublicShareShell } from '@/components/layout/PublicShareShell'
import { ProtectedRoute } from '@/components/auth/ProtectedRoute'
import { RouteErrorBoundary } from '@/components/common/ErrorBoundary'

const BookmarksPage = lazy(() => import('@/pages/bookmarks/BookmarksPage').then(({ BookmarksPage: page }) => ({ default: page })))
const BookmarkTrashPage = lazy(() => import('@/pages/bookmarks/BookmarkTrashPage').then(({ BookmarkTrashPage: page }) => ({ default: page })))
const TabGroupsPage = lazy(() => import('@/pages/tab-groups/TabGroupsPage').then(({ TabGroupsPage: page }) => ({ default: page })))
const TabGroupDetailPage = lazy(() => import('@/pages/tab-groups/TabGroupDetailPage').then(({ TabGroupDetailPage: page }) => ({ default: page })))
const TabGroupsTrashPage = lazy(() => import('@/pages/tab-groups/TabGroupsTrashPage').then(({ TabGroupsTrashPage: page }) => ({ default: page })))
const SettingsPage = lazy(() => import('@/pages/settings/SettingsPage').then(({ SettingsPage: page }) => ({ default: page })))
const LoginPage = lazy(() => import('@/pages/auth/LoginPage').then(({ LoginPage: page }) => ({ default: page })))
const PublicSharePage = lazy(() => import('@/pages/public/PublicSharePage').then(({ PublicSharePage: page }) => ({ default: page })))

function RouteLoading() {
  const { t } = useTranslation('common')
  return <div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">{t('action.loading')}</div>
}

// R5-14: per-route boundary (keyed by pathname inside) so a page render error
// replaces only the content area — the shell navigation stays interactive and
// navigating away resets the error.
function guarded(element: React.ReactNode) {
  return <RouteErrorBoundary>{element}</RouteErrorBoundary>
}

export function AppRouter() {
  return (
    <Suspense fallback={<RouteLoading />}>
      <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<PublicShareShell />}>
        <Route path="/share/:slug" element={guarded(<PublicSharePage />)} />
      </Route>
      <Route element={<ProtectedRoute />}>
        <Route element={<FullScreenAppShell />}>
          <Route path="/" element={guarded(<BookmarksPage />)} />
          <Route path="/tab" element={guarded(<TabGroupsPage />)} />
          <Route path="/tab/:id" element={guarded(<TabGroupDetailPage />)} />
        </Route>
      </Route>
      <Route element={<ProtectedRoute />}>
        <Route element={<AppShell />}>
          <Route path="/bookmarks/trash" element={guarded(<BookmarkTrashPage />)} />
          <Route path="/tab/trash" element={guarded(<TabGroupsTrashPage />)} />
          <Route path="/settings/*" element={guarded(<SettingsPage />)} />
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  )
}
