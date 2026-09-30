/**
 * TMark 扩展 i18n:最小 zustand store + persist。
 * - locale 持久化到 chrome.storage.local(key 'tmark:locale'),popup/options/SW 三处共享。
 * - 初始 locale:从 storage 异步 rehydrate;未 rehydrate 前用 navigator.language 推断。
 * - 组件用 useI18n()(订阅 locale 自动重渲染);非组件模块(notifications/background/format)用 tt()/currentLocale()。
 */
import { useEffect } from 'react'
import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { dict, ensureEnDict } from './i18n-dict'

type Locale = 'zh' | 'en'
export type TranslateFn = (key: string, vars?: Record<string, string | number>) => string

interface I18nState {
  locale: Locale
  t: TranslateFn
  setLocale: (locale: Locale) => void
}

function detectInitialLocale(): Locale {
  try {
    return navigator.language.startsWith('en') ? 'en' : 'zh'
  } catch {
    return 'zh'
  }
}

/** 按 locale 翻译;支持 {{var}} 插值;缺失回退 zh 再回退 key 原值。 */
export function translate(locale: Locale, key: string, vars?: Record<string, string | number>): string {
  let str = dict[locale][key] ?? dict.zh[key] ?? key
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      str = str.replaceAll(`{{${k}}}`, String(v))
    }
  }
  return str
}

/** persist 存储:chrome.storage.local 优先(跨上下文共享),不可用时内存兜底。 */
const localeStorage = {
  getItem: (name: string): Promise<string | null> =>
    new Promise((resolve) => {
      try {
        chrome.storage.local.get(name, (r) => resolve((r[name] as string | undefined) ?? null))
      } catch {
        resolve(null)
      }
    }),
  setItem: (name: string, value: string): Promise<void> =>
    new Promise((resolve) => {
      try {
        chrome.storage.local.set({ [name]: value }, () => resolve())
      } catch {
        resolve()
      }
    }),
  removeItem: (name: string): Promise<void> =>
    new Promise((resolve) => {
      try {
        chrome.storage.local.remove(name, () => resolve())
      } catch {
        resolve()
      }
    }),
}

const useI18nStore = create<I18nState>()(
  persist(
    (set, get) => ({
      locale: detectInitialLocale(),
      t: (key, vars) => translate(get().locale, key, vars),
      setLocale: (locale) => {
        set({ locale })
        if (locale === 'en') void ensureEnDict()
      },
    }),
    { name: 'tmark:locale', storage: createJSONStorage(() => localeStorage) },
  ),
)

// 冷启动探测:persist 恢复的 locale 不经过 setLocale,订阅一次以捕获。
if (detectInitialLocale() === 'en') void ensureEnDict()
useI18nStore.subscribe((state) => {
  if (state.locale === 'en') void ensureEnDict()
})

/** React 组件用:订阅 locale 变化自动重渲染,返回 { t, locale, setLocale }。 */
export function useI18n(): { t: TranslateFn; locale: Locale; setLocale: (l: Locale) => void } {
  const locale = useI18nStore((s) => s.locale)
  const setLocale = useI18nStore((s) => s.setLocale)
  const t = useI18nStore((s) => s.t)
  // <html lang> 随 locale 更新:index.html 静态写了 zh,en 用户的读屏此前
  // 一直按中文发音。仅 DOM 上下文(popup/options 窗口)生效,SW 无 document。
  useEffect(() => {
    document.documentElement.lang = locale
  }, [locale])
  return { t, locale, setLocale }
}

/** 非组件模块取当前翻译(读取最新 locale)。 */
export function tt(key: string, vars?: Record<string, string | number>): string {
  return useI18nStore.getState().t(key, vars)
}

/** 非组件模块取当前 locale(formatTime 本地化用)。 */
export function currentLocale(): Locale {
  return useI18nStore.getState().locale
}
