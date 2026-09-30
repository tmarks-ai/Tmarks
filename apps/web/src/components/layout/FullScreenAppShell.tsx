import { Outlet, useNavigate, useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { MobileBottomNav } from '@/components/layout/MobileBottomNav'
import { ThemedRoot } from '@/components/layout/ThemedRoot'
import { ShellHeader } from '@/components/layout/ShellHeader'
import { ShellHeaderRight } from '@/components/layout/ShellHeaderRight'

/**
 * 全屏工作区 AppShell:header + 无 padding 的弹性 main(供 WorkspaceLayout 撑满
 * 高度)+ 底部导航。书签工作区等需要纵向占满的页面使用此壳。
 */
export function FullScreenAppShell() {
  const { t } = useTranslation('common')
  const navigate = useNavigate()
  const location = useLocation()
  const isOnTabGroupsPage = location.pathname.startsWith('/tab')

  return (
    <ThemedRoot className="flex h-screen flex-col overflow-hidden">
      <ShellHeader
        title="TMarks"
        subtitle={isOnTabGroupsPage ? t('nav.manageTabGroups') : t('nav.smartBookmarkManagement')}
        onHome={() => navigate('/')}
        right={<ShellHeaderRight />}
      />
      <main className="flex w-full min-h-0 flex-1 flex-col overflow-hidden pb-16 sm:pb-0">
        <Outlet />
      </main>
      <MobileBottomNav />
    </ThemedRoot>
  )
}
