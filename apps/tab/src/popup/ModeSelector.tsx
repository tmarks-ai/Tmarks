import { useEffect, useState } from 'react'
import { Bookmark, Boxes, Clock, Settings } from 'lucide-react'
import { useI18n } from '../lib/i18n'
import { loadTMarksUrls, type TMarksUrls } from '../lib/constants/urls'

interface Props {
  onSelectBookmark: () => void
  onSelectTabCollection: () => void
  onOpenOptions: () => void
}

/** 实时时钟卡:独立组件承接 1s interval——此前 interval 挂在 ModeSelector 上,
 *  每秒整棵选择器树(两大卡片 + footer)跟着重渲染。 */
function ClockCard() {
  const { t, locale } = useI18n()
  const [now, setNow] = useState(new Date())

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000)
    return () => window.clearInterval(timer)
  }, [])

  const pad = (n: number): string => String(n).padStart(2, '0')
  const time = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`
  const weekday = t(`weekday.${now.getDay()}`)
  const date = locale === 'zh' ? `${now.getFullYear()}年 ${now.getMonth() + 1}月 ${now.getDate()}日 ${weekday}` : `${weekday}, ${now.getMonth() + 1}/${now.getDate()}/${now.getFullYear()}`

  return (
    <section className="rounded-xl border border-[var(--tab-popup-border)] bg-[var(--tab-popup-surface)] p-3 shadow-lg">
      <div className="flex items-center justify-between text-[var(--tab-popup-text)]">
        <span className="flex items-center gap-1.5 text-xs font-semibold"><Clock className="h-3.5 w-3.5" />{t('popup.tips')}</span>
        <span className="font-mono text-base font-bold tracking-wider">{time}</span>
      </div>
      <div className="mt-1.5 text-xs text-[var(--tab-popup-text-muted)]">{date}</div>
    </section>
  )
}

/** 落地页(模式选择):复刻旧版 ModeSelector — 渐变 logo 砖 + 实时时钟卡 + 保存/收集两大卡 + footer web 链接。 */
export function ModeSelector({ onSelectBookmark, onSelectTabCollection, onOpenOptions }: Props) {
  const { t } = useI18n()
  const [urls, setUrls] = useState<TMarksUrls | null>(null)

  useEffect(() => {
    void loadTMarksUrls().then(setUrls)
  }, [])

  return (
    <div className="relative h-[var(--tab-popup-height)] w-[var(--tab-popup-width)] overflow-hidden rounded-2xl bg-[var(--tab-popup-bg)] text-[var(--tab-popup-text)] shadow-2xl">
      <div className="relative flex h-full flex-col">
        <header className="px-5 pb-3 pt-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-[var(--tab-popup-primary-from)] to-[var(--tab-popup-primary-via)] shadow-lg">
                <Bookmark className="h-5 w-5 text-[var(--tab-popup-primary-text)]" />
              </div>
              <h1 className="text-lg font-bold text-[var(--tab-popup-text)]">{t('popup.title')}</h1>
            </div>
            <button type="button" onClick={onOpenOptions} title={t('popup.openSettings')} className="flex h-9 w-9 items-center justify-center rounded-lg text-[var(--tab-popup-text-muted)] transition-all duration-200 hover:bg-[var(--tab-popup-action-neutral-bg)] active:scale-95">
              <Settings className="h-4 w-4" />
            </button>
          </div>
        </header>

        <main className="flex-1 space-y-3 overflow-y-auto bg-[var(--tab-popup-bg)] px-5 pb-[60px]">
          <ClockCard />

          <button type="button" onClick={onSelectBookmark} className="group w-full rounded-xl border border-[var(--tab-popup-border)] bg-[var(--tab-popup-surface)] p-4 text-left shadow-lg transition-all duration-200 hover:scale-[1.02] hover:border-[var(--tab-popup-section-blue-border)] hover:shadow-xl active:scale-[0.98]">
            <div className="flex items-start gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-[var(--tab-popup-action-blue-text)] to-[var(--tab-popup-badge-indigo-text)] shadow-lg transition-transform duration-200 group-hover:scale-110">
                <Bookmark className="h-5 w-5 text-[var(--tab-popup-primary-text)]" />
              </div>
              <div className="flex-1">
                <h2 className="text-base font-semibold text-[var(--tab-popup-text)]">{t('popup.saveBookmark')}</h2>
                <p className="mt-0.5 text-xs text-[var(--tab-popup-text-muted)]">{t('popup.saveBookmarkDesc')}</p>
              </div>
            </div>
          </button>

          <button type="button" onClick={onSelectTabCollection} className="group w-full rounded-xl border border-[var(--tab-popup-border)] bg-[var(--tab-popup-surface)] p-4 text-left shadow-lg transition-all duration-200 hover:scale-[1.02] hover:border-[var(--tab-popup-section-emerald-border)] hover:shadow-xl active:scale-[0.98]">
            <div className="flex items-start gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-[var(--tab-popup-action-emerald-text)] to-[var(--tab-popup-section-emerald-icon)] shadow-lg transition-transform duration-200 group-hover:scale-110">
                <Boxes className="h-5 w-5 text-[var(--tab-popup-primary-text)]" />
              </div>
              <div className="flex-1">
                <h2 className="text-base font-semibold text-[var(--tab-popup-text)]">{t('popup.collectTabs')}</h2>
                <p className="mt-0.5 text-xs text-[var(--tab-popup-text-muted)]">{t('popup.collectTabsDesc')}</p>
              </div>
            </div>
          </button>
        </main>

        <footer className="fixed bottom-0 left-0 right-0 z-[var(--tab-z-header)] bg-[var(--tab-popup-footer-bg)]/80 p-2 backdrop-blur-sm">
          <div className="flex gap-2">
            <button type="button" onClick={() => void chrome.tabs.create({ url: urls?.WEB_APP })} disabled={!urls} className="flex-1 rounded-lg border border-[var(--tab-popup-border)] bg-[var(--tab-popup-surface)] py-2.5 text-center text-sm text-[var(--tab-popup-text)] shadow-sm transition-colors hover:bg-[var(--tab-popup-action-neutral-bg)] disabled:opacity-50">
              {t('popup.myBookmarks')}
            </button>
            <button type="button" onClick={() => void chrome.tabs.create({ url: urls?.TAB_GROUPS })} disabled={!urls} className="flex-1 rounded-lg border border-[var(--tab-popup-border)] bg-[var(--tab-popup-surface)] py-2.5 text-center text-sm text-[var(--tab-popup-text)] shadow-sm transition-colors hover:bg-[var(--tab-popup-action-neutral-bg)] disabled:opacity-50">
              {t('popup.myCollections')}
            </button>
          </div>
        </footer>
      </div>
    </div>
  )
}
