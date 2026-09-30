/**
 * 主题管理:亮/暗/auto 切换(由 .dark 类驱动),移植自旧版 themeManager。
 * 偏好持久化到 chrome.storage.local(tmark:theme),auto 跟随系统 prefers-color-scheme。
 */

export type Theme = 'auto' | 'light' | 'dark'

const THEME_KEY = 'tmark:theme'
let currentTheme: Theme = 'auto'

function prefersDark(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-color-scheme: dark)').matches
    : false
}

/** 应用主题(切换 <html> 的 .dark 类);不写存储。 */
function applyTheme(theme: Theme): void {
  currentTheme = theme
  const isDark = theme === 'dark' || (theme === 'auto' && prefersDark())
  document.documentElement.classList.toggle('dark', isDark)
}

/** 设置主题并持久化。 */
export function setTheme(theme: Theme): void {
  applyTheme(theme)
  try {
    void chrome.storage.local.set({ [THEME_KEY]: theme })
  } catch {
    /* ignore */
  }
}

export function getTheme(): Theme {
  return currentTheme
}

/** 订阅系统深色变化(auto 模式下跟随)。 */
function initThemeListener(): void {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (currentTheme === 'auto') applyTheme('auto')
  })
}

/** 启动时读偏好并应用 + 注册监听。 */
export async function loadAndApplyTheme(): Promise<void> {
  let theme: Theme = 'auto'
  try {
    const res = await chrome.storage.local.get(THEME_KEY)
    theme = (res[THEME_KEY] as Theme) ?? 'auto'
  } catch {
    /* ignore */
  }
  applyTheme(theme)
  initThemeListener()
}
