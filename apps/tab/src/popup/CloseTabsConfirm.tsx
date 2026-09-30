import { Check } from 'lucide-react'
import { useI18n } from '../lib/i18n'

interface Props {
  count: number
  busy?: boolean
  onKeep: () => void
  onClose: () => void
}

/** 采集后顶部确认条:复刻旧版 CloseTabsConfirm 的成功渐变卡片(绿勾 + 计数 + 保留/关闭按钮)。 */
export function CloseTabsConfirm({ count, busy = false, onKeep, onClose }: Props) {
  const { t } = useI18n()
  return (
    <div className="fixed left-0 right-0 top-[var(--tab-popup-header-h)] z-[var(--tab-z-close-confirm)] px-4 pt-2 animate-in slide-in-from-top-5 fade-in duration-300">
      <section className="rounded-2xl border border-[var(--tab-message-success-border)] p-4 shadow-lg" style={{ background: 'linear-gradient(135deg, var(--tab-message-success-bg), var(--tab-message-success-icon-bg))' }}>
        <div className="mb-3 flex items-start gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--tab-message-success-icon-bg)]">
            <Check className="h-5 w-5 text-[var(--tab-message-success-icon)]" />
          </div>
          <div className="flex-1">
            <h3 className="text-sm font-semibold text-[var(--tab-text)]">{t('tabCollection.success')}</h3>
            <p className="mt-1 text-xs text-[var(--tab-text-muted)]">{t('tabCollection.collectedCount', { count })}</p>
          </div>
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={onKeep} disabled={busy} className="flex-1 rounded-xl border border-[var(--tab-border-strong)] bg-[var(--tab-surface)] px-4 py-2 text-sm font-medium text-[var(--tab-text)] transition-all duration-200 hover:bg-[var(--tab-surface-muted)] active:scale-95 disabled:cursor-not-allowed disabled:opacity-50">{t('tabCollection.keepTabs')}</button>
          <button type="button" onClick={onClose} disabled={busy} className="flex-1 rounded-xl px-4 py-2 text-sm font-semibold shadow-sm transition-all duration-200 hover:shadow-md active:scale-95 disabled:cursor-not-allowed disabled:opacity-50" style={{ background: 'linear-gradient(90deg, var(--tab-popup-success-from), var(--tab-popup-success-to))', color: 'var(--tab-popup-success-text)' }}>{t('tabCollection.closeTabs')}</button>
        </div>
      </section>
    </div>
  )
}
