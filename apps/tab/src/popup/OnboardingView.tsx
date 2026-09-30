import { Bookmark, Plus } from 'lucide-react'
import { useI18n } from '../lib/i18n'

interface Props {
  onOpenOptions: () => void
}

/** 未配置引导:复刻旧版 OnboardingView — 暗色径向蒙层 + 玻璃卡 + 必填信息 + 前往设置渐变按钮。 */
export function OnboardingView({ onOpenOptions }: Props) {
  const { t } = useI18n()
  // 步骤与触发条件(未配置账户 API Key)对齐:先填后端地址,再在 Web 端创建
  // 并填入账户 Key——原先第三步指向不存在的"站点访问密钥"设置,新用户照做
  // 会卡死在引导页。
  const steps = [t('popup.configApiOrigin'), t('popup.configAccountKey'), t('popup.configApiKey')]
  return (
    <div className="relative h-[var(--tab-popup-height)] w-[var(--tab-popup-width)] overflow-hidden rounded-2xl bg-[var(--tab-popup-onboarding-bg)] text-[var(--tab-popup-primary-text)] shadow-2xl">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,_var(--tab-popup-onboarding-radial-top),transparent_70%)] opacity-80" />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_bottom,_var(--tab-popup-onboarding-radial-bottom),transparent_65%)] opacity-80" />
      <div className="absolute inset-0 bg-[var(--tab-popup-onboarding-overlay)] backdrop-blur-2xl" />
      <div className="relative flex h-full flex-col">
        <header className="px-6 pb-6 pt-8">
          <div className="rounded-3xl border border-[var(--tab-popup-onboarding-card-border)] bg-[var(--tab-popup-onboarding-card-bg)] p-5 shadow-xl backdrop-blur-xl">
            <div className="flex items-start gap-4">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-[var(--tab-popup-primary-from)] to-[var(--tab-popup-primary-via)] shadow-lg">
                <Bookmark className="h-6 w-6 text-[var(--tab-popup-primary-text)]" />
              </div>
              <div className="space-y-1">
                <p className="text-xs uppercase tracking-[0.18em] text-[var(--tab-popup-onboarding-label)]">{t('popup.onboarding')}</p>
                <h1 className="text-2xl font-semibold">{t('popup.welcome')}</h1>
                <p className="text-sm text-[var(--tab-popup-onboarding-desc)]">{t('popup.welcomeDesc')}</p>
              </div>
            </div>
          </div>
        </header>
        <main className="flex-1 space-y-5 overflow-y-auto px-6 pb-6">
          <section className="rounded-3xl border border-[var(--tab-popup-onboarding-card-border)] bg-[var(--tab-popup-onboarding-subtle-bg)] p-5 backdrop-blur-xl">
            <h2 className="text-sm font-semibold">{t('popup.requiredInfo')}</h2>
            <p className="mt-1 text-xs text-[var(--tab-popup-onboarding-label)]">{t('popup.requiredInfoDesc')}</p>
            <ol className="mt-4 space-y-3 text-xs">
              {steps.map((item, idx) => (
                <li key={idx} className="flex gap-3 rounded-2xl border border-[var(--tab-popup-onboarding-subtle-border)] bg-[var(--tab-popup-onboarding-subtle-bg)] p-3">
                  <span className="flex h-6 w-6 items-center justify-center rounded-xl bg-[var(--tab-popup-onboarding-tip-bg)] text-[11px] font-semibold text-[var(--tab-popup-onboarding-tip-text)]">{idx + 1}</span>
                  <div><p className="font-semibold">{item}</p></div>
                </li>
              ))}
            </ol>
          </section>
        </main>
        <footer className="px-6 pb-6">
          <button type="button" onClick={onOpenOptions} className="flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-[var(--tab-popup-primary-from)] via-[var(--tab-popup-primary-via)] to-[var(--tab-popup-primary-to)] px-6 py-3 text-sm font-semibold shadow-lg transition-all hover:shadow-xl active:scale-95">
            <Plus className="h-4 w-4" />
            {t('popup.goSettings')}
          </button>
        </footer>
      </div>
    </div>
  )
}
