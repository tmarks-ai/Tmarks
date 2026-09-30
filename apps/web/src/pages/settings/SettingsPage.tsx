import { useEffect } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Monitor, User, KeyRound, Download, Share2, Activity } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'
import { BasicSection, AppearanceSection, BrowserSection, type TFunc } from './SettingsSections'
import { ApiSection, DataSection } from './SettingsSectionsApi'
import { PublicShareSection } from './PublicShareSection'
import { SyncHealthSection } from './SyncHealthSection'

type Section = 'basic' | 'api' | 'data' | 'appearance' | 'browser' | 'share' | 'sync-health'

const NAV: Array<{ id: Section; icon: typeof User; group: string }> = [
  { id: 'basic', icon: User, group: 'preferences' },
  { id: 'appearance', icon: Monitor, group: 'preferences' },
  { id: 'api', icon: KeyRound, group: 'data' },
  { id: 'data', icon: Download, group: 'data' },
  { id: 'sync-health', icon: Activity, group: 'data' },
  { id: 'browser', icon: Monitor, group: 'connect' },
  { id: 'share', icon: Share2, group: 'connect' },
]

const VALID_SECTIONS = new Set<Section>(NAV.map((n) => n.id))

export function SettingsPage() {
  const { t } = useTranslation('settings')
  const { t: tc } = useTranslation('common')
  useDocumentTitle(t('pageTitle'))
  const location = useLocation()
  const navigate = useNavigate()

  const pathSection = location.pathname.replace('/settings/', '').replace('/settings', '')
  const section = VALID_SECTIONS.has(pathSection as Section) ? pathSection as Section : 'basic'

  useEffect(() => {
    if (!VALID_SECTIONS.has(pathSection as Section)) navigate('/settings/basic', { replace: true })
  }, [navigate, pathSection])

  const switchSection = (next: Section) => {
    navigate(`/settings/${next}`, { replace: true })
  }

  const groups = ['preferences', 'data', 'connect'] as const

  return (
    <div className="mx-auto w-full max-w-5xl py-4 sm:py-6">
      <div className="grid gap-4 lg:grid-cols-[14rem_minmax(0,1fr)]">
        <nav aria-label={tc('nav.settings')} className="lg:sticky lg:top-24 lg:self-start">
          <div className="rounded-2xl border border-border/60 bg-card/70 p-2">
            {groups.map((g) => (
              <div key={g} className="mb-1">
                <p className="px-3 py-1.5 text-[0.6875rem] font-medium uppercase tracking-wider text-muted-foreground/80">{t(`navGroup.${g}`)}</p>
                {NAV.filter((n) => n.group === g).map(({ id, icon: Icon }) => (
                  <button key={id} type="button" onClick={() => switchSection(id)} className={cn('flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium', section === id ? 'bg-primary/10 text-primary shadow-[inset_2px_0_0_0_var(--primary)]' : 'text-muted-foreground hover:bg-muted hover:text-foreground')}>
                    <Icon className="h-4 w-4" /> {t(`tabs.${id}`)}
                  </button>
                ))}
              </div>
            ))}
          </div>
        </nav>
        <section className="rounded-2xl border border-border/60 bg-card/70 p-5 sm:p-6">
          {section === 'basic' && <BasicSection t={t as TFunc} />}
          {section === 'appearance' && <AppearanceSection t={t as TFunc} />}
          {section === 'browser' && <BrowserSection t={t as TFunc} />}
          {section === 'api' && <ApiSection t={t as TFunc} />}
          {section === 'data' && <DataSection t={t as TFunc} />}
          {section === 'sync-health' && <SyncHealthSection t={t as TFunc} />}
          {section === 'share' && <PublicShareSection t={t as TFunc} />}
        </section>
      </div>
    </div>
  )
}
