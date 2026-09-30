import { useTranslation } from 'react-i18next'
import { Sun, Moon } from 'lucide-react'
import { useThemeStore } from '@/stores/themeStore'
import { useResolvedTheme, getNextExplicitTheme } from '@/shared/ui-theme'

export function ThemeToggle() {
  const { t } = useTranslation('common')
  const preference = useThemeStore((s) => s.preference)
  const setPreference = useThemeStore((s) => s.setPreference)
  const resolvedTheme = useResolvedTheme(preference)
  const next = getNextExplicitTheme(resolvedTheme)

  return (
    <button
      onClick={() => setPreference(next)}
      className="inline-flex h-11 w-11 items-center justify-center rounded-2xl text-foreground transition-colors hover:bg-muted hover:text-foreground active:scale-95"
      aria-label={next === 'dark' ? t('nav.toggleDarkMode') : t('nav.toggleLightMode')}
    >
      {resolvedTheme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
    </button>
  )
}
