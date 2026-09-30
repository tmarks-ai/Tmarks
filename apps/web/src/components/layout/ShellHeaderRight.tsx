import { useNavigate, useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { BookOpen, Layers, User } from 'lucide-react'
import { useAuthStore } from '@/stores/authStore'
import { ThemeToggle } from '@/components/common/ThemeToggle'

/** ShellHeader 右侧操作区:标签页收纳切换 + 主题 + 用户设置入口。 */
export function ShellHeaderRight() {
  const { t } = useTranslation('common')
  const navigate = useNavigate()
  const location = useLocation()
  const user = useAuthStore((s) => s.user)
  const isOnTabGroupsPage = location.pathname.startsWith('/tab')

  return (
    <div className="flex items-center gap-5">
      <button
        type="button"
        onClick={() => navigate(isOnTabGroupsPage ? '/' : '/tab')}
        className="hidden h-11 w-11 items-center justify-center rounded-2xl text-foreground transition-colors hover:bg-muted hover:text-foreground active:scale-95 sm:flex"
        aria-label={isOnTabGroupsPage ? t('nav.switchToBookmarks') : t('nav.switchToTabGroups')}
      >
        {isOnTabGroupsPage ? <BookOpen className="w-5 h-5" /> : <Layers className="w-5 h-5" />}
      </button>
      <ThemeToggle />
      {user && (
        <button
          type="button"
          onClick={() => navigate('/settings/basic')}
          className="inline-flex h-11 w-11 items-center justify-center rounded-2xl text-foreground transition-colors hover:bg-muted hover:text-foreground active:scale-95"
          aria-label={t('nav.userSettings', { username: user.username })}
        >
          <User className="w-5 h-5" />
        </button>
      )}
    </div>
  )
}
