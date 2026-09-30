import { cn } from '../lib/utils/cn'
import { useCallback, useEffect, useState } from 'react'
import { ArrowLeft, Loader2, Plus } from 'lucide-react'
import { getCredentials, isAuthenticated } from '../lib/api/auth'
import { useI18n } from '../lib/i18n'
import { loadAndApplyTheme } from '../lib/utils/themeManager'
import { MessageLayer, type Notify } from '../components/MessageLayer'
import { ModeSelector } from './ModeSelector'
import { TabCollectionView } from './TabCollectionView'
import { OnboardingView } from './OnboardingView'
import { BookmarkModeView } from './BookmarkModeView'
import { useBookmarkSave } from './useBookmarkSave'

type ViewMode = 'selector' | 'bookmark' | 'tabCollection'

/** TMark popup 壳:复刻旧版 viewMode(selector|bookmark|tabCollection) 三态切换 + tmarks 主题 + 消息层。
 *  每个视图卡自带 --tab-popup-width×--tab-popup-height rounded-2xl 浮卡。主题在挂载时读偏好应用(auto/light/dark)。 */
export function Popup() {
  const [view, setView] = useState<ViewMode>('selector')
  const [authed, setAuthed] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [loadingMsg, setLoadingMsg] = useState<string | null>(null)

  const notify = useCallback<Notify>((level, text) => {
    if (level === 'error') setError(text)
    else if (level === 'success') { setLoadingMsg(null); setSuccess(text) }
    else setLoadingMsg(text)
  }, [])
  const dismissError = useCallback(() => setError(null), [])
  const dismissSuccess = useCallback(() => setSuccess(null), [])
  const clearLoading = useCallback(() => setLoadingMsg(null), [])

  useEffect(() => { void loadAndApplyTheme() }, [])
  useEffect(() => {
    const load = async (): Promise<void> => setAuthed(isAuthenticated(await getCredentials()))
    void load()
    const listener = (_c: unknown, area: string): void => { if (area === 'local') void load() }
    chrome.storage.onChanged.addListener(listener)
    return () => chrome.storage.onChanged.removeListener(listener)
  }, [])

  const openOptions = (): void => { void chrome.runtime.openOptionsPage() }

  if (view === 'selector') {
    return <ModeSelector onSelectBookmark={() => setView('bookmark')} onSelectTabCollection={() => (authed ? setView('tabCollection') : openOptions())} onOpenOptions={openOptions} />
  }
  if (view === 'tabCollection') {
    return <TabCollectionView notify={notify} error={error} success={success} loading={loadingMsg} onDismissError={dismissError} onDismissSuccess={dismissSuccess} onClearLoading={clearLoading} onBack={() => setView('selector')} />
  }
  return <BookmarkPane notify={notify} error={error} success={success} loading={loadingMsg} onDismissError={dismissError} onDismissSuccess={dismissSuccess} onClearLoading={clearLoading} authed={authed} onBack={() => setView('selector')} onOpenOptions={openOptions} />
}

interface PaneProps {
  notify: Notify; error: string | null; success: string | null; loading: string | null
  onDismissError: () => void; onDismissSuccess: () => void; onClearLoading: () => void
  authed: boolean; onBack: () => void; onOpenOptions: () => void
}

/** 书签模式卡(独立组件以让 useBookmarkSave 仅在本视图挂载时运行)。复刻旧版固定 header+footer。 */
function BookmarkPane({ notify, error, success, loading, onDismissError, onDismissSuccess, onClearLoading, authed, onBack, onOpenOptions }: PaneProps) {
  const { t } = useI18n()
  const save = useBookmarkSave(notify, t)
  const [customTag, setCustomTag] = useState('')

  if (!authed) return <OnboardingView onOpenOptions={onOpenOptions} />

  const submitCustom = (): void => {
    const trimmed = customTag.trim()
    if (!trimmed) return
    save.addCustomTag(trimmed)
    setCustomTag('')
  }

  const badge = (bg: string, text: string, label: string) => (
    <span className={cn(`inline-flex shrink-0 items-center rounded-full ${bg} px-2 py-1 text-[10px] font-medium ${label}`)}>{text}</span>
  )

  return (
    <div className="relative h-[var(--tab-popup-height)] w-[var(--tab-popup-width)] overflow-hidden rounded-2xl bg-[var(--tab-popup-surface)] text-[var(--tab-popup-text)] shadow-2xl">
      <MessageLayer error={error} success={success} loading={loading} onDismissError={onDismissError} onDismissSuccess={onDismissSuccess} onClearLoading={onClearLoading} onRetry={() => { onDismissError(); save.reload() }} />
      <div className="relative flex h-full flex-col">
        <header className="fixed left-0 right-0 top-0 z-[var(--tab-z-header)] border-b border-[var(--tab-popup-border)] bg-[var(--tab-popup-surface)] px-3 pb-2.5 pt-2 shadow-sm">
          <div className="flex items-center gap-2">
            <button type="button" onClick={onBack} title={t('popup.back')} aria-label={t('popup.back')} className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-[var(--tab-popup-text-muted)] transition-all hover:bg-[var(--tab-popup-action-neutral-bg)] active:scale-95"><ArrowLeft className="h-4 w-4" /></button>
            {/* 徽章区可收缩:英文 locale 下三个计数徽章 + 双按钮会超 380px 宽,
                flex-1+overflow-hidden 让溢出裁掉最不重要的尾部徽章,而不是把
                保存按钮顶出 rounded-2xl 卡外被整块裁切。 */}
            <div className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden">
              {save.aiEnabled
                ? badge('bg-[var(--tab-popup-badge-blue-bg)]', t('popup.recommendCount', { count: save.recommendedTags.length }), 'text-[var(--tab-popup-badge-blue-text)]')
                : badge('bg-[var(--tab-popup-badge-amber-bg)]', t('popup.aiOff'), 'text-[var(--tab-popup-badge-amber-text)]')}
              {badge('bg-[var(--tab-popup-badge-indigo-bg)]', t('popup.selectedCount', { count: save.selectedTags.length }), 'text-[var(--tab-popup-badge-indigo-text)]')}
              {badge('bg-[var(--tab-popup-badge-purple-bg)]', t('popup.libraryCount', { count: save.visibleTags.length }), 'text-[var(--tab-popup-badge-purple-text)]')}
            </div>
            <div className="flex shrink-0 gap-1.5">
              <button type="button" onClick={() => window.close()} className="rounded-lg border border-[var(--tab-popup-border-strong)] bg-[var(--tab-popup-surface)] px-3 py-1.5 text-[11px] font-medium text-[var(--tab-popup-text)] transition-all hover:bg-[var(--tab-popup-action-neutral-bg)] active:scale-95">{t('btn.cancel')}</button>
              <button type="button" onClick={() => void save.handleSave()} disabled={save.saving || save.aiBusy} className="rounded-lg bg-gradient-to-r from-[var(--tab-popup-primary-from)] to-[var(--tab-popup-primary-via)] px-4 py-1.5 text-[11px] font-semibold text-[var(--tab-popup-primary-text)] shadow-sm transition-all hover:shadow-md disabled:cursor-not-allowed disabled:opacity-40 active:scale-95">
                {save.saving ? t('popup.saving') : t('popup.saveBookmark')}
              </button>
            </div>
          </div>
        </header>

        <main className="relative flex-1 space-y-2.5 overflow-y-auto bg-[var(--tab-popup-bg)] px-4 pb-[70px] pt-[var(--tab-popup-header-h)]">
          {save.loading ? (
            <section className="flex items-center gap-3 rounded-xl border border-[var(--tab-popup-border)] bg-[var(--tab-popup-section-gray-bg)] p-3.5 text-sm text-[var(--tab-popup-text)] shadow-lg"><Loader2 className="h-4 w-4 animate-spin" /><p>{t('popup.loading')}</p></section>
          ) : (
            <BookmarkModeView save={save} tagTheme="classic" />
          )}
        </main>

        <footer className="fixed bottom-0 left-0 right-0 z-[var(--tab-z-header)] rounded-t-2xl border-t border-[var(--tab-popup-footer-border)] bg-[var(--tab-popup-footer-bg)] px-3 pb-2.5 pt-2 shadow-sm">
          <div className="flex items-center gap-2">
            <Plus className="h-4 w-4 shrink-0 text-[var(--tab-popup-text-muted)]" />
            <input type="text" value={customTag} maxLength={50} onChange={(e) => setCustomTag(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') submitCustom() }} placeholder={t('popup.save.tagsPlaceholder')} className="flex-1 rounded-xl border border-[var(--tab-popup-input-border)] bg-[var(--tab-popup-input-bg)] px-3 py-1.5 text-sm text-[var(--tab-popup-input-text)] placeholder:text-[var(--tab-popup-input-placeholder)] focus:border-[var(--tab-popup-input-focus-border)]" />
            <button type="button" onClick={submitCustom} disabled={!customTag.trim()} className="rounded-xl bg-gradient-to-r from-[var(--tab-popup-primary-from)] to-[var(--tab-popup-primary-via)] px-4 py-1.5 text-sm font-medium text-[var(--tab-popup-primary-text)] shadow-sm transition-all hover:shadow-md disabled:cursor-not-allowed disabled:opacity-40 active:scale-95">{t('popup.addTag')}</button>
          </div>
        </footer>
      </div>
    </div>
  )
}
