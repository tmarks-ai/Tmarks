/** 同步模式标签 + 时间格式化(popup/options 共用,避免重复)。 */
import { tt, currentLocale } from './i18n'

/** 同步模式标签(据当前 locale 翻译;未知模式回退原值,保持旧行为)。 */
export function syncModeLabel(mode: string): string {
  const key = `syncMode.${mode}`
  const v = tt(key)
  return v === key ? mode : v
}

/** 时间格式化:null 显示"尚未同步";否则按当前 locale 本地化。 */
export function formatTime(iso: string | null): string {
  if (!iso) return tt('format.neverSynced')
  try {
    return new Date(iso).toLocaleString(currentLocale() === 'en' ? 'en-US' : 'zh-CN', {
      hour: '2-digit',
      minute: '2-digit',
      month: '2-digit',
      day: '2-digit',
    })
  } catch {
    return iso
  }
}
