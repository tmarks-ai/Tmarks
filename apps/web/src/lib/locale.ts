import { enUS, zhCN } from 'date-fns/locale'
import type { Locale } from 'date-fns'

/**
 * Single source of truth for mapping an i18next language tag onto a locale.
 *
 * Matching used to be split between `language.startsWith('zh')` and
 * `language === 'zh-CN'`, so a detected `zh` or `zh-TW` produced a Chinese UI
 * with en-US dates. Prefix matching is the correct rule: every Chinese variant
 * should get Chinese formatting.
 */
export function isChineseLocale(language: string | undefined): boolean {
  return Boolean(language?.toLowerCase().startsWith('zh'))
}

/** BCP-47 tag for Intl.* formatters. */
export function intlLocale(language: string | undefined): string {
  return isChineseLocale(language) ? 'zh-CN' : 'en-US'
}

/** date-fns locale object for `formatDistanceToNow` and friends. */
export function dateFnsLocale(language: string | undefined): Locale {
  return isChineseLocale(language) ? zhCN : enUS
}
