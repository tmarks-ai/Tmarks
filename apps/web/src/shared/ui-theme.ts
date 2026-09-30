import { useEffect, useState } from 'react'

import type { ThemePreference } from './theme-types'

type ResolvedTheme = 'light' | 'dark'

const SYSTEM_DARK_QUERY = '(prefers-color-scheme: dark)'

function resolveThemePreference(
  preference: ThemePreference,
  systemPrefersDark = getSystemPrefersDark(),
): ResolvedTheme {
  if (preference === 'system') return systemPrefersDark ? 'dark' : 'light'
  return preference
}

export function useResolvedTheme(preference: ThemePreference): ResolvedTheme {
  const [systemPrefersDark, setSystemPrefersDark] = useState(() => getSystemPrefersDark())

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return
    const mediaQuery = window.matchMedia(SYSTEM_DARK_QUERY)
    const update = () => setSystemPrefersDark(mediaQuery.matches)
    update()
    mediaQuery.addEventListener('change', update)
    return () => mediaQuery.removeEventListener('change', update)
  }, [])

  return resolveThemePreference(preference, systemPrefersDark)
}

export function useDocumentTheme(preference: ThemePreference): ResolvedTheme {
  const resolvedTheme = useResolvedTheme(preference)

  useEffect(() => applyDocumentTheme(preference, resolvedTheme), [preference, resolvedTheme])

  return resolvedTheme
}

export function getNextExplicitTheme(resolvedTheme: ResolvedTheme): ThemePreference {
  return resolvedTheme === 'dark' ? 'light' : 'dark'
}

function applyDocumentTheme(preference: ThemePreference, resolvedTheme: ResolvedTheme) {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  root.classList.toggle('dark', resolvedTheme === 'dark')
  root.dataset.theme = preference
  root.dataset.resolvedTheme = resolvedTheme

  return () => {
    root.classList.remove('dark')
    delete root.dataset.theme
    delete root.dataset.resolvedTheme
  }
}

function getSystemPrefersDark() {
  return typeof window !== 'undefined' && window.matchMedia?.(SYSTEM_DARK_QUERY).matches === true
}
