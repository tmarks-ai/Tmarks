import { intlLocale } from '@/lib/locale'

/** 卡片网格密度(外观设置)。 */
export type BookmarkDensity = 'compact' | 'normal' | 'comfortable'

/** 密度 → 列间距(gap)/卡片行距(mb)的映射。 */
export const DENSITY_SPACING: Record<BookmarkDensity, { gap: string; margin: string }> = {
  compact: { gap: 'gap-2', margin: 'mb-2' },
  normal: { gap: 'gap-3', margin: 'mb-3' },
  comfortable: { gap: 'gap-5', margin: 'mb-5' },
}

export function getBookmarkDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

export function getBookmarkFolderLabel(folderPath: string[] | undefined, uncategorizedLabel: string): string {
  return folderPath && folderPath.length > 0 ? folderPath.join(' / ') : uncategorizedLabel
}

export function formatBookmarkDate(value: string | null, language: string): string {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''

  return new Intl.DateTimeFormat(intlLocale(language), {
    month: 'short',
    day: 'numeric',
  }).format(date)
}

/** 带年份与时分的时间格式(快照列表等需要精确到分钟的场景)。 */
export function formatBookmarkDateTime(value: string, language: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return new Intl.DateTimeFormat(intlLocale(language), {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}
