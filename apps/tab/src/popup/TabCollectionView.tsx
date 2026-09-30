import { cn } from '../lib/utils/cn'
import { useEffect, useState } from 'react'
import { ArrowLeft, Check, Loader2 } from 'lucide-react'
import type { EntityId } from '@tmarks/contracts'
import { normalizeUrlKey } from '@tmarks/ai/url'
import { collectCurrentWindowTabs, closeCollectedTabs, type CollectResult } from '../lib/services/tab-collection'
import { isCollectableTabUrl } from '../lib/services/tab-collection-rules'
import { bookmarksByUrlKey } from '../lib/services/bookmark-lookup'
import { useI18n } from '../lib/i18n'
import { MessageLayer, type Notify } from '../components/MessageLayer'
import { CollectionOptionsDialog, type CollectionOption } from './CollectionOptionsDialog'
import { CloseTabsConfirm } from './CloseTabsConfirm'

interface CollectOpt { target_group_id?: EntityId; parent_id?: EntityId | null; title?: string }
interface Props {
  notify: Notify
  error: string | null
  success: string | null
  loading: string | null
  onDismissError: () => void
  onDismissSuccess: () => void
  onClearLoading: () => void
  onBack: () => void
}

/** 标签页采集视图:复刻旧版 TabCollectionView — 固定 header(返回+总数/已选 badge+Cancel/Options/Collect 成功渐变)
 *  + 全选卡 + 标签页列表(选中=绿) + CloseTabsConfirm + CollectionOptionsDialog。接新服务 collectCurrentWindowTabs。 */
export function TabCollectionView({ notify, error, success, loading, onDismissError, onDismissSuccess, onClearLoading, onBack }: Props) {
  const { t } = useI18n()
  const [tabs, setTabs] = useState<chrome.tabs.Tab[]>([])
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [busy, setBusy] = useState('')
  const [loadBusy, setLoadBusy] = useState(true)
  const [showOptions, setShowOptions] = useState(false)
  const [lastResult, setLastResult] = useState<CollectResult | null>(null)
  const [savedUrls, setSavedUrls] = useState<Set<string>>(new Set())

  const loadTabs = async (): Promise<void> => {
    setLoadBusy(true)
    try {
      const all = await chrome.tabs.query({ currentWindow: true })
      const valid = all.filter((tab) => isCollectableTabUrl(tab.url) && tab.id != null)
      setTabs(valid)
      setSelected(new Set())
      const urls = valid.map((tab) => tab.url).filter((u): u is string => Boolean(u))
      if (urls.length > 0) {
        // 与保存路径同一把尺(normalizeUrlKey):utm/尾斜杠变体也算已存,
        // 否则刚保存/同步下来的同页会误报未存。走共享扫描缓存,与书签
        // 视图合并为一次全表扫描。
        const saved = await bookmarksByUrlKey()
        setSavedUrls(new Set(urls.filter((u) => saved.has(normalizeUrlKey(u)))))
      } else setSavedUrls(new Set())
    } catch {
      notify('error', t('popup.toast.loadFail'))
    } finally {
      setLoadBusy(false)
    }
  }

  useEffect(() => { void loadTabs() }, [])

  const allSelected = tabs.length > 0 && selected.size === tabs.length
  const toggleAll = (): void => setSelected(() => {
    if (allSelected) return new Set()
    return new Set(tabs.map((tab) => tab.id as number))
  })
  const toggle = (id: number): void => setSelected((cur) => {
    const next = new Set(cur)
    if (next.has(id)) next.delete(id); else next.add(id)
    return next
  })

  const doCollect = async (opt: CollectOpt = {}): Promise<void> => {
    if (selected.size === 0) { notify('error', t('popup.selectAtLeastOne')); return }
    setBusy('collect')
    try {
      const result = await collectCurrentWindowTabs({ selectedTabIds: new Set(selected), ...opt })
      if (!result.success) { notify('error', t(result.error ?? 'popup.toast.collectFail')); return }
      const collectedUrls = tabs.filter((tab) => tab.id != null && selected.has(tab.id) && tab.url).map((tab) => tab.url as string)
      setSavedUrls((cur) => new Set([...cur, ...collectedUrls]))
      if (result.duplicate) notify('success', t('popup.toast.collectDup'))
      else if (opt.target_group_id) notify('success', t('popup.addedToGroup', { count: result.count ?? 0, skipped: result.skipped ?? 0 }))
      else notify('success', t('popup.collected', { count: result.count ?? 0, skipped: result.skipped ?? 0 }))
      setLastResult(result)
    } catch {
      notify('error', t('popup.toast.collectFail'))
    } finally {
      setBusy('')
    }
  }

  const handleOption = (option: CollectionOption): void => {
    setShowOptions(false)
    void doCollect(option.mode === 'existing' ? { target_group_id: option.targetId } : option.mode === 'folder' ? { parent_id: option.parentId ?? null, title: option.title } : { title: option.title })
  }

  const handleCloseTabs = async (): Promise<void> => {
    const ids = lastResult?.tabIds ?? []
    if (ids.length === 0 || busy === 'close') return
    setBusy('close')
    try { await closeCollectedTabs(ids); setLastResult(null) }
    catch { notify('error', t('popup.toast.closeFail')) }
    finally { setBusy('') }
  }

  const showClose = Boolean(lastResult?.success && (lastResult?.tabIds?.length ?? 0) > 0)

  return (
    <div className="relative h-[var(--tab-popup-height)] w-[var(--tab-popup-width)] overflow-hidden rounded-b-2xl bg-[var(--tab-popup-bg)] text-[var(--tab-text)] shadow-2xl">
      {showOptions && <CollectionOptionsDialog selectedCount={selected.size} onConfirm={handleOption} onCancel={() => setShowOptions(false)} />}
      <MessageLayer error={error} success={success} loading={loading} onDismissError={onDismissError} onDismissSuccess={onDismissSuccess} onClearLoading={onClearLoading} onRetry={() => { onDismissError(); void loadTabs() }} />
      <div className="relative flex h-full flex-col">
        <header className="fixed left-0 right-0 top-0 z-[var(--tab-z-header)] rounded-b-2xl border-b border-[var(--tab-border)] bg-[var(--tab-surface)] px-3 pb-2.5 pt-2 shadow-sm">
          <div className="flex items-center gap-2">
            <button type="button" onClick={onBack} title={t('popup.back')} aria-label={t('popup.back')} className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-[var(--tab-text-muted)] transition-all duration-200 hover:bg-[var(--tab-surface-muted)] active:scale-95"><ArrowLeft className="h-4 w-4" /></button>
            {/* 徽章区可收缩(同书签页):英文下溢出裁尾部徽章,不裁采集按钮。 */}
            <div className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden">
              <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-[var(--tab-message-success-bg)] px-2 py-1 text-[10px] font-medium text-[var(--tab-message-success-icon)]">{t('tabCollection.total', { count: tabs.length })}</span>
              <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-[var(--tab-popup-badge-indigo-bg)] px-2 py-1 text-[10px] font-medium text-[var(--tab-popup-badge-indigo-text)]">{t('tabCollection.selected', { count: selected.size })}</span>
            </div>
            <div className="flex shrink-0 gap-1.5">
              {/* Cancel 与书签页同语义:放弃本次操作并关闭弹窗;返回选择器用左侧箭头。 */}
              <button type="button" onClick={() => window.close()} className="rounded-lg border border-[var(--tab-border-strong)] bg-[var(--tab-surface)] px-3 py-1.5 text-[11px] font-medium text-[var(--tab-text)] transition-all duration-200 hover:bg-[var(--tab-surface-muted)] active:scale-95">{t('btn.cancel')}</button>
              <button type="button" onClick={() => setShowOptions(true)} disabled={busy !== '' || selected.size === 0} className="rounded-lg border border-[var(--tab-border-strong)] bg-[var(--tab-surface)] px-3 py-1.5 text-[11px] font-medium text-[var(--tab-text)] transition-all duration-200 hover:bg-[var(--tab-surface-muted)] disabled:cursor-not-allowed disabled:opacity-40 active:scale-95">{t('popup.options')}</button>
              <button type="button" onClick={() => void doCollect()} disabled={busy !== '' || selected.size === 0} className="rounded-lg px-4 py-1.5 text-[11px] font-semibold shadow-sm transition-all duration-200 hover:shadow-md disabled:cursor-not-allowed disabled:opacity-40 active:scale-95" style={{ background: 'linear-gradient(90deg, var(--tab-popup-success-from), var(--tab-popup-success-to))', color: 'var(--tab-popup-success-text)' }}>
                {busy === 'collect' ? <span className="flex items-center justify-center gap-1"><Loader2 className="h-3.5 w-3.5 animate-spin" />{t('popup.collecting')}</span> : t('popup.collect')}
              </button>
            </div>
          </div>
        </header>

        {showClose && <CloseTabsConfirm count={lastResult!.tabIds!.length} busy={busy === 'close'} onKeep={() => setLastResult(null)} onClose={() => void handleCloseTabs()} />}

        <main className={cn(`relative flex-1 space-y-3 overflow-y-auto bg-[var(--tab-popup-bg)] px-4 pb-5 ${showClose ? 'pt-[var(--tab-popup-close-reserve)]' : 'pt-[var(--tab-popup-header-h)]'}`)}>
          {loadBusy ? (
            <section className="flex items-center gap-3 rounded-2xl border border-[var(--tab-border)] bg-[var(--tab-surface)] p-4 text-sm text-[var(--tab-text)] shadow-sm"><Loader2 className="h-4 w-4 animate-spin" /><p>{t('tabCollection.loading')}</p></section>
          ) : tabs.length === 0 ? (
            <section className="flex items-center justify-center rounded-2xl border border-[var(--tab-border)] bg-[var(--tab-surface)] p-6 text-sm text-[var(--tab-text-muted)] shadow-sm">{t('popup.noTabs')}</section>
          ) : (
            <>
              <section className="rounded-2xl border border-[var(--tab-border)] bg-[var(--tab-surface)] p-3 shadow-sm">
                <button type="button" onClick={toggleAll} disabled={tabs.length === 0} className="flex w-full items-center justify-between rounded-xl bg-[var(--tab-surface-muted)] px-4 py-2 text-sm font-medium text-[var(--tab-text)] transition-all duration-200 hover:opacity-90 active:scale-95">
                  <span>{allSelected ? t('tabCollection.deselectAll') : t('tabCollection.selectAll')}</span>
                  <span className="text-xs text-[var(--tab-text-muted)]">{selected.size} / {tabs.length}</span>
                </button>
              </section>
              <section className="space-y-2">
                {tabs.map((tab) => {
                  const id = tab.id as number
                  const on = selected.has(id)
                  return (
                    <button key={id} type="button" onClick={() => toggle(id)} className={cn(`group w-full rounded-2xl border p-3 text-left transition-all duration-200 active:scale-[0.98] ${on ? 'border-[var(--tab-message-success-border)] bg-[var(--tab-message-success-bg)] shadow-md' : 'border-[var(--tab-border)] bg-[var(--tab-surface)] hover:bg-[var(--tab-surface-muted)]'}`)}>
                      <div className="flex items-start gap-3">
                        <div className={cn(`mt-0.5 flex h-5 w-5 items-center justify-center rounded-md border-2 transition-all duration-200 ${on ? 'border-[var(--tab-popup-success-from)] bg-[var(--tab-popup-success-from)]' : 'border-[var(--tab-border-strong)] bg-[var(--tab-surface)]'}`)}>{on && <Check className="h-3 w-3 text-[var(--tab-popup-success-text)]" />}</div>
                        {tab.favIconUrl ? <img src={tab.favIconUrl} alt="" className="h-5 w-5 rounded" onError={(e) => { (e.currentTarget as HTMLImageElement).style.visibility = 'hidden' }} /> : null}
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium text-[var(--tab-text)]">{tab.title || tab.url}{savedUrls.has(tab.url as string) && <span role="img" className="ml-1 inline-block h-2 w-2 rounded-full bg-[var(--tab-message-success-icon)] align-middle" title={t('popup.toast.saved')} aria-label={t('popup.toast.saved')} />}</p>
                          <p className="truncate text-xs text-[var(--tab-text-muted)]">{tab.url}</p>
                        </div>
                      </div>
                    </button>
                  )
                })}
              </section>
            </>
          )}
        </main>
      </div>
    </div>
  )
}
