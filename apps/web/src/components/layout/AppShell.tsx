import { Outlet, useNavigate, useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { MobileBottomNav } from '@/components/layout/MobileBottomNav'
import { ThemedRoot } from '@/components/layout/ThemedRoot'
import { ShellHeader } from '@/components/layout/ShellHeader'
import { ShellHeaderRight } from '@/components/layout/ShellHeaderRight'

/**
 * 设置等流式页用的 AppShell:header + 带 padding/max-width 的 main + 底部导航。
 * 书签工作区等全屏页改用 FullScreenAppShell。
 */
export function AppShell() {
  const { t } = useTranslation('common')
  const navigate = useNavigate()
  const location = useLocation()

  const isOnTabGroupsPage = location.pathname.startsWith('/tab')

  return (
    <ThemedRoot>
      <ShellHeader
        title="TMarks"
        subtitle={isOnTabGroupsPage ? t('nav.manageTabGroups') : t('nav.smartBookmarkManagement')}
        onHome={() => navigate('/')}
        right={<ShellHeaderRight />}
      />
      <main className="w-full px-3 pb-16 pt-3 sm:px-6 sm:pb-6 sm:pt-6 flex min-h-0 flex-1 flex-col bg-muted/30">
        <div className="mx-auto w-full">
          <Outlet />
        </div>
      </main>
      <MobileBottomNav />
    </ThemedRoot>
  )
}
