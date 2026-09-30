import { Outlet, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ThemedRoot } from './ThemedRoot'
import { ShellHeader } from './ShellHeader'
import { ThemeToggle } from '@/components/common/ThemeToggle'
import { Button } from '@/components/ui/button'

/** 公開分享页只读外壳；标题栏仍复用私有工作台的基础组件。 */
export function PublicShareShell() {
  const { t } = useTranslation('common')
  const navigate = useNavigate()

  return (
    <ThemedRoot className="flex h-screen flex-col overflow-hidden">
      <ShellHeader
        title="TMarks"
        subtitle={t('nav.smartBookmarkManagement')}
        onHome={() => navigate('/')}
        right={
          <>
            <ThemeToggle />
            <Button variant="ghost" size="sm" onClick={() => navigate('/login')}>
              {t('action.login')}
            </Button>
          </>
        }
      />
      <main className="flex min-h-0 flex-1 flex-col overflow-hidden bg-muted/30">
        <Outlet />
      </main>
    </ThemedRoot>
  )
}
