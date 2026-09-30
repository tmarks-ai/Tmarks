import type { ComponentType } from 'react'
import { cn } from '@/lib/utils'
import { useNavigate, useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { BookOpen, Layers } from 'lucide-react'
import { Z_INDEX } from '@/lib/constants/z-index'

interface NavItem {
  id: string
  labelKey: string
  icon: ComponentType<{ className?: string }>
  path: string
}

export function MobileBottomNav() {
  const { t } = useTranslation('common')
  const navigate = useNavigate()
  const location = useLocation()

  const navItems: NavItem[] = [
    { id: 'bookmarks', labelKey: 'nav.bookmarks', icon: BookOpen, path: '/' },
    { id: 'tab-groups', labelKey: 'nav.tabGroups', icon: Layers, path: '/tab' },
  ]

  const isActive = (path: string) =>
    path === '/' ? location.pathname === '/' : location.pathname === path || location.pathname.startsWith(path + '/')

  return (
    <div className="fixed bottom-0 left-0 right-0 bg-card border-t border-border sm:hidden z-layer-sticky" style={{ zIndex: Z_INDEX.MOBILE_BOTTOM_NAV }}>
      <div className="grid grid-cols-2 h-16">
        {navItems.map((item) => {
          const Icon = item.icon
          const active = isActive(item.path)
          return (
            <button
              key={item.id}
              onClick={() => navigate(item.path)}
              aria-current={active ? 'page' : undefined}
              className={cn(`flex flex-col items-center justify-center space-y-1 px-2 py-2 transition-colors duration-200 touch-manipulation ${
                active ? 'text-primary' : 'text-muted-foreground hover:text-foreground'
              }`)}
            >
              <Icon className="h-5 w-5" />
              <span className="text-xs font-medium">{t(item.labelKey)}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
