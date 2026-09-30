import { useNavigate } from 'react-router-dom'
import {
  ArrowDownUp, Download, Folder, Hash, HelpCircle, Languages, LayoutGrid,
  ListChecks, LogOut, Monitor, Moon, Palette, PanelRight, Puzzle,
  Rows3, Settings, ShieldAlert, Sun, Tags, User,
} from 'lucide-react'
import type {
  BookmarkAuxPanelPreference, DensityPreference, SortByPreference, ThemePreference,
  UpdatePreferencesInput, ViewModePreference,
} from '@tmarks/contracts'
import { useThemeStore } from '@/stores/themeStore'
import { useAuthStore } from '@/stores/authStore'
import { supportedLanguages } from '@/i18n'
import i18n from '@/i18n'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { usePreferences, useUpdatePreferences } from '@/hooks/usePreferences'
import { PAGE_SIZE_OPTIONS } from '@/lib/constants/bookmarks'
import { LANDING_PAGE_URL } from '@/lib/constants/extension'
import { cn } from '@/lib/utils'
import { SectionHeader, SettingGroup, SaveFeedback, SegmentToggle } from './SettingPrimitives'
import { PasswordChangeGroup } from './PasswordChangeGroup'

export type TFunc = (k: string, opts?: Record<string, unknown>) => string

/** 通用区:主题 + 界面语言 + 账户 + 工作台（导航/每页/辅助面板）。 */
export function BasicSection({ t }: { t: TFunc }): React.ReactElement {
  const { preference, setPreference } = useThemeStore()
  const { user, logout } = useAuthStore()
  const navigate = useNavigate()
  const { prefs, update, patch } = usePrefPatch()

  const detected = (typeof navigator !== 'undefined' ? navigator.language : 'zh-CN')
  // i18n.language is the live source of truth; i18next's LanguageDetector keeps
  // localStorage['tmarks-language'] in step on every changeLanguage call.
  const langSource = i18n.language || detected
  const currentLang = supportedLanguages.find((l) => langSource === l.code || langSource.startsWith(l.code.split('-')[0]))?.code ?? 'zh-CN'
  // Switching in place rather than reloading: a reload tears down the SPA and
  // discards the in-memory access token, forcing a silent-refresh round trip.
  const changeLang = (code: string) => { void i18n.changeLanguage(code) }

  return (
    <div className="space-y-5">
      <SectionHeader title={t('tabs.basic')} description={t('description')} icon={Settings} />
      <div className="grid gap-4 lg:grid-cols-2">
        <SettingGroup icon={Palette} title={t('general.theme')} description={t('general.themeDesc')}>
          <SegmentToggle<ThemePreference>
            value={preference}
            onChange={setPreference}
            options={[
              { value: 'system', label: t('general.themeSystem'), icon: Monitor },
              { value: 'light', label: t('general.themeLight'), icon: Sun },
              { value: 'dark', label: t('general.themeDark'), icon: Moon },
            ]}
          />
        </SettingGroup>
        <SettingGroup icon={Languages} title={t('language.label')} description={t('language.description')}>
          <div className="flex flex-wrap gap-2">
            {supportedLanguages.map((l) => (
              <button
                key={l.code}
                type="button"
                onClick={() => changeLang(l.code)}
                className={cn(
                  'rounded-lg border px-3 py-1.5 text-sm transition-colors',
                  currentLang === l.code ? 'border-primary bg-primary/10 text-primary' : 'border-border hover:bg-muted hover:text-foreground',
                )}
              >
                {l.nativeName}
              </button>
            ))}
          </div>
        </SettingGroup>
        <SettingGroup icon={User} title={t('basic.accountInfo.title')} description={t('basic.accountInfo.description')}>
          <div className="flex items-center justify-between gap-3">
            <div className="space-y-0.5">
              <p className="text-sm font-medium">{t('basic.username')}: {user?.username ?? ''}</p>
              {user?.email && <p className="text-xs text-muted-foreground">{user.email}</p>}
            </div>
            <Button variant="destructive" size="sm" onClick={async () => { await logout(); navigate('/login', { replace: true }) }}>
              <LogOut className="h-4 w-4" /> {t('action.logout')}
            </Button>
          </div>
        </SettingGroup>
        <PasswordChangeGroup t={t} />
        <SettingGroup icon={Folder} title={t('workspace.nav.title')} description={t('workspace.nav.description')}>
          <SegmentToggle
            value={prefs?.bookmark_nav_mode ?? 'folders'}
            onChange={(v) => patch({ bookmark_nav_mode: v })}
            options={[
              { value: 'folders', label: t('workspace.nav.folders.title') },
              { value: 'tags', label: t('workspace.nav.tags.title') },
            ]}
          />
        </SettingGroup>
        <SettingGroup icon={Hash} title={t('workspace.pageSize.title')} description={t('workspace.pageSize.description')}>
          <Select value={String(prefs?.page_size ?? 30)} onValueChange={(v) => patch({ page_size: Number(v) })}>
            <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
            <SelectContent>
              {PAGE_SIZE_OPTIONS.map((size) => (
                <SelectItem key={size} value={String(size)}>{size}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </SettingGroup>
        <SettingGroup icon={PanelRight} title={t('workspace.auxPanel.title')} description={t('workspace.auxPanel.description')}>
          <Select value={prefs?.bookmark_aux_panel ?? 'right'} onValueChange={(v) => patch({ bookmark_aux_panel: v as BookmarkAuxPanelPreference })}>
            <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="right">{t('workspace.auxPanel.right')}</SelectItem>
              <SelectItem value="drawer">{t('workspace.auxPanel.drawer')}</SelectItem>
              <SelectItem value="hidden">{t('workspace.auxPanel.hidden')}</SelectItem>
            </SelectContent>
          </Select>
        </SettingGroup>
      </div>
      <SaveFeedback update={update} t={t} />
    </div>
  )
}

function usePrefPatch() {
  const { data } = usePreferences()
  const update = useUpdatePreferences()
  return { prefs: data?.preferences, update, patch: (p: UpdatePreferencesInput) => update.mutate(p) }
}

/** 外观区:默认视图 / 排序 / 密度 / 标签布局(2×2 网格)。 */
export function AppearanceSection({ t }: { t: TFunc }): React.ReactElement {
  const { prefs, update, patch } = usePrefPatch()
  return (
    <div className="space-y-5">
      <SectionHeader title={t('tabs.appearance')} icon={Palette} />
      <div className="grid gap-4 lg:grid-cols-2">
        <SettingGroup icon={LayoutGrid} title={t('appearance.view.title')} description={t('appearance.view.description')}>
          <SegmentToggle<ViewModePreference>
            value={prefs?.view_mode ?? 'card'}
            onChange={(v) => patch({ view_mode: v })}
            options={[
              { value: 'card', label: t('appearance.view.card') },
              { value: 'minimal', label: t('appearance.view.minimal') },
            ]}
          />
        </SettingGroup>
        <SettingGroup icon={ArrowDownUp} title={t('appearance.sort.title')} description={t('appearance.sort.description')}>
          <Select value={prefs?.sort_by ?? 'created'} onValueChange={(v) => patch({ sort_by: v as SortByPreference })}>
            <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="created">{t('appearance.sort.created')}</SelectItem>
              <SelectItem value="updated">{t('appearance.sort.updated')}</SelectItem>
              <SelectItem value="popular">{t('appearance.sort.popular')}</SelectItem>
            </SelectContent>
          </Select>
        </SettingGroup>
        <SettingGroup icon={Rows3} title={t('appearance.density.title')} description={t('appearance.density.description')}>
          <Select value={prefs?.density ?? 'normal'} onValueChange={(v) => patch({ density: v as DensityPreference })}>
            <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="compact">{t('appearance.density.compact')}</SelectItem>
              <SelectItem value="normal">{t('appearance.density.normal')}</SelectItem>
              <SelectItem value="comfortable">{t('appearance.density.comfortable')}</SelectItem>
            </SelectContent>
          </Select>
        </SettingGroup>
        <SettingGroup icon={Tags} title={t('appearance.tagLayout.title')} description={t('appearance.tagLayout.description')}>
          <SegmentToggle
            value={prefs?.tag_layout ?? 'grid'}
            onChange={(v) => patch({ tag_layout: v })}
            options={[
              { value: 'grid', label: t('appearance.tagLayout.grid') },
              { value: 'masonry', label: t('appearance.tagLayout.masonry') },
            ]}
          />
        </SettingGroup>
      </div>
      <SaveFeedback update={update} t={t} />
    </div>
  )
}

/** 浏览器区:下载 / 弹窗权限(两列) + 安装步骤 / FAQ(跨列)。 */
export function BrowserSection({ t }: { t: TFunc }): React.ReactElement {
  return (
    <div className="space-y-5">
      <SectionHeader title={t('tabs.browser')} icon={Puzzle} />
      <div className="grid gap-4 lg:grid-cols-2">
        <SettingGroup
          icon={Download}
          title={t('browser.download.title')}
          description={t('browser.download.description')}
          actions={LANDING_PAGE_URL ? (
            <Button asChild size="sm"><a href={LANDING_PAGE_URL} target="_blank" rel="noreferrer"><Download className="h-4 w-4" /> {t('browser.download.goToLanding')}</a></Button>
          ) : undefined}
        >
          <p className="text-xs text-muted-foreground">{t('browser.download.tip')}</p>
        </SettingGroup>
        <SettingGroup icon={ShieldAlert} title={t('browser.popup.title')} description={t('browser.popup.description')}>
          <div className="space-y-1.5 text-sm text-muted-foreground">
            <p className="font-medium text-foreground">{t('browser.popup.howTo')}</p>
            {[1, 2, 3, 4].map((n) => <p key={n}>{t(`browser.popup.step${n}`)}</p>)}
          </div>
        </SettingGroup>
        <SettingGroup icon={ListChecks} title={t('browser.install.title')} description={t('browser.install.description')} className="lg:col-span-2">
          <ol className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
            {[1, 2, 3, 4, 5, 6].map((n) => (
              <li key={n} className="flex gap-2.5 text-sm">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">{n}</span>
                <span className="text-muted-foreground"><span className="font-medium text-foreground">{t(`browser.install.step${n}Title`)}</span> — {t(`browser.install.step${n}Desc`)}</span>
              </li>
            ))}
          </ol>
        </SettingGroup>
        <SettingGroup icon={HelpCircle} title={t('browser.faq.title')} className="lg:col-span-2">
          <div className="grid gap-3 sm:grid-cols-2">
            <Faq q={t('browser.faq.iconNotFound')} a={t('browser.faq.iconNotFoundAnswer')} />
            <Faq q={t('browser.faq.howToGetApiKey')} a={t('browser.faq.howToGetApiKeyAnswer')} />
            <Faq q={t('browser.faq.supportedBrowsers')} a={t('browser.faq.supportedBrowsersAnswer')} />
            <Faq q={t('browser.faq.whereToView')} a={t('browser.faq.whereToViewAnswer')} />
          </div>
        </SettingGroup>
      </div>
    </div>
  )
}

function Faq({ q, a }: { q: string; a: string }): React.ReactElement {
  return (
    <div className="space-y-0.5 text-sm">
      <p className="font-medium text-foreground">{q}</p>
      <p className="text-muted-foreground">{a}</p>
    </div>
  )
}
