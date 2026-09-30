import { useCallback, useEffect, useState, type ReactElement } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { BookmarkCheck, Database, KeyRound, Palette, Sparkles } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { getCredentials, type Credentials } from '../lib/api/auth'
import { getApiOrigin } from '../lib/api/config'
import { db } from '../lib/db'
import { useI18n } from '../lib/i18n'
import { loadAndApplyTheme, setTheme } from '../lib/utils/themeManager'
import { DEFAULT_SAVE_DEFAULTS, saveSaveDefaults } from '../lib/utils/save-defaults'
import { confirmDialog } from '../lib/ui/confirm'
import { Button } from '../lib/ui/button'
import { cn } from '../lib/ui/cn'
import { Section } from '../lib/ui/section'
import { Flash, useFlash } from '../lib/ui/flash'
import { AccountSection } from './sections/AccountSection'
import { SettingsSection } from './sections/SettingsSection'
import { SyncReviewSection } from './sections/SyncReviewSection'
import { AiSection } from './sections/AiSection'
import { AiPreferences } from './sections/AiPreferences'
import { DataSection } from './sections/DataSection'
import { PreferencesSection } from './sections/PreferencesSection'
import { CacheStatusSection } from './sections/CacheStatusSection'

type Tab = 'ai' | 'account' | 'preferences' | 'data'

/** TMark 选项页:精简页头 + 顶部分段 tab + 全宽单卡内容。
 *  4 tab:AI 助手(连接+整理)/ 账户与同步(API key+源+同步+状态+失败队列)/ 外观偏好 / 数据管理。
 *  各段独立保存;页头仅 Reset(重置偏好)+ 鉴权状态;主题挂载时读偏好应用。 */
export function Options(): ReactElement {
  const { t } = useI18n()
  const [cred, setCred] = useState<Credentials>({})
  const [origin, setOrigin] = useState('')
  const { msg, flash } = useFlash()
  const [activeTab, setActiveTab] = useState<Tab>('ai')

  const syncState = useLiveQuery(() => db.syncState.get('singleton'), [])

  const reload = useCallback(async () => {
    const [c, o] = await Promise.all([getCredentials(), getApiOrigin()])
    setCred(c)
    setOrigin(o)
  }, [])

  useEffect(() => {
    void loadAndApplyTheme()
    void reload()
    const listener = () => void reload()
    chrome.storage.onChanged.addListener(listener)
    return () => chrome.storage.onChanged.removeListener(listener)
  }, [reload])

  const authed = Boolean(cred.api_key)

  const handleReset = async () => {
    const ok = await confirmDialog({ message: t('confirm.reset'), confirmText: t('btn.reset'), danger: true })
    if (!ok) return
    setTheme('auto')
    await saveSaveDefaults(DEFAULT_SAVE_DEFAULTS)
    flash('ok', t('options.resetDone'))
  }

  const tabs: { id: Tab; label: string; icon: LucideIcon }[] = [
    { id: 'ai', label: t('options.tab.ai'), icon: Sparkles },
    { id: 'account', label: t('options.tab.account'), icon: KeyRound },
    { id: 'preferences', label: t('options.tab.preferences'), icon: Palette },
    { id: 'data', label: t('options.tab.data'), icon: Database },
  ]

  return (
    <div className="min-h-screen w-screen bg-gradient-to-br from-[var(--tab-options-page-bg-from)] via-[var(--tab-options-page-bg-via)] to-[var(--tab-options-page-bg-to)]">
      <div className="mx-auto w-full max-w-5xl px-6 py-8">
        {/* 精简页头 */}
        <div className="flex items-center justify-between gap-4">
          <div className="space-y-1">
            <h1 className="flex items-center gap-2 text-xl font-bold tracking-tight text-[var(--tab-options-title)]">
              <BookmarkCheck className="h-5 w-5 text-[var(--tab-options-button-primary-bg)]" />
              {t('options.heroTitle')}
            </h1>
            <p className="text-sm text-muted-foreground">{t('options.heroDesc')}</p>
            <Flash msg={msg} className="mt-1" />
          </div>
            <div className="flex shrink-0 items-center gap-2">
              <span className={cn(
                'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium',
                authed
                  ? 'border-[var(--tab-options-cache-metric-emerald-border)] bg-[var(--tab-options-cache-metric-emerald-bg)] text-[var(--tab-options-cache-metric-emerald-label)]'
                  : 'border-[var(--tab-options-card-border)] bg-[var(--tab-options-tag-bg)] text-[var(--tab-options-text-muted)]',
              )}>
                <span className={cn('h-1.5 w-1.5 rounded-full', authed ? 'bg-emerald-500' : 'bg-muted-foreground/50')} />
                {authed ? t('options.statusAuthed') : t('options.statusGuest')}
              </span>
              <Button variant="outline" size="sm" onClick={() => void handleReset()}>{t('btn.reset')}</Button>
            </div>
          </div>

          {/* 顶部分段 tab */}
          <div className="mt-6 inline-flex flex-wrap gap-1 rounded-xl border border-[var(--tab-options-card-border)] bg-[var(--tab-options-card-bg)] p-1 shadow-sm backdrop-blur">
            {tabs.map((tab) => {
              const Icon = tab.icon
              return (
                <button key={tab.id} type="button" onClick={() => setActiveTab(tab.id)} aria-pressed={activeTab === tab.id} className={cn(
                  'inline-flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-sm font-medium transition-colors',
                  activeTab === tab.id
                    ? 'bg-[var(--tab-options-button-primary-bg)] text-[var(--tab-options-button-primary-text)] shadow-sm'
                    : 'text-[var(--tab-options-text)] hover:bg-[var(--tab-options-button-hover-bg)]',
                )}>
                  <Icon className="h-4 w-4" />
                  {tab.label}
                </button>
              )
            })}
          </div>

          {/* 全宽单卡内容 */}
          <div className="mt-6">
            {activeTab === 'ai' && (
              <Section className="divide-y divide-[var(--tab-options-card-border)]">
                <AiSection />
                <AiPreferences />
              </Section>
            )}
            {activeTab === 'account' && (
              <Section className="divide-y divide-[var(--tab-options-card-border)]">
                <AccountSection cred={cred} reload={reload} />
                <SettingsSection origin={origin} syncState={syncState ?? null} authed={authed} reload={reload} />
                <CacheStatusSection />
                <SyncReviewSection />
              </Section>
            )}
            {activeTab === 'preferences' && (
              <Section>
                <PreferencesSection />
              </Section>
            )}
            {activeTab === 'data' && (
              <Section>
                <DataSection />
              </Section>
            )}
          </div>
        </div>
      </div>
  )
}
