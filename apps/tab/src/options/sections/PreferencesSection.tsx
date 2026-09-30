import { cn } from '../../lib/utils/cn'
import { useEffect, useState } from 'react'
import { Palette, SlidersHorizontal } from 'lucide-react'
import { getTheme, setTheme, type Theme } from '../../lib/utils/themeManager'
import { loadSaveDefaults, saveSaveDefaults, type SaveDefaults } from '../../lib/utils/save-defaults'
import { useI18n } from '../../lib/i18n'
import { BlockHeader } from '../../lib/ui/section'
import { Row } from '../../lib/ui/switch'
import { Field } from '../../lib/ui/field'
import { Flash, useFlash } from '../../lib/ui/flash'

/** 偏好段:主题(auto/light/dark)+ 保存默认(含封面/快照)。复刻旧版 PreferencesSection 双卡。
 *  主题走 themeManager(setTheme 应用+持久化);默认值走共享 save-defaults(供 popup 读取初始化)。 */
export function PreferencesSection() {
  const { t } = useI18n()
  const [theme, setThemeState] = useState<Theme>('auto')
  const [defaults, setDefaults] = useState<SaveDefaults>({ includeCover: false, snapshot: false, defaultIsPrivate: false })
  const { msg, flash } = useFlash()

  useEffect(() => { setThemeState(getTheme()); void loadSaveDefaults().then(setDefaults) }, [])

  const pickTheme = (next: Theme) => {
    try {
      setTheme(next)
      setThemeState(next)
    } catch {
      flash('err', t('pref.saveFail'))
    }
  }

  const toggleDefault = (key: keyof SaveDefaults) => {
    // setState updater 必须纯净(StrictMode 会重放 updater):持久化副作用
    // 移出 updater,基于当前 state 计算后一次落盘。
    setDefaults((prev) => {
      const next = { ...prev, [key]: !prev[key] }
      return next
    })
    void saveSaveDefaults({ ...defaults, [key]: !defaults[key] }).catch(() => flash('err', t('pref.saveFail')))
  }

  return (
    <div>
      <BlockHeader icon={Palette} title={t('pref.appearanceTitle')} description={t('pref.appearanceDesc')} />
      <div className="mt-4">
        <Field label={t('pref.theme')}>
          <div className="inline-flex rounded-xl border border-[var(--tab-options-card-border)] bg-[var(--tab-options-card-bg)] p-1 text-sm font-medium text-foreground">
            <ThemeBtn value="auto" current={theme} label={t('pref.themeAuto')} onClick={pickTheme} />
            <ThemeBtn value="light" current={theme} label={t('pref.themeLight')} onClick={pickTheme} />
            <ThemeBtn value="dark" current={theme} label={t('pref.themeDark')} onClick={pickTheme} />
          </div>
        </Field>
        <p className="mt-2 text-xs text-muted-foreground">{t('pref.themeHint')}</p>
      </div>

      <div className="mt-4 border-t border-[var(--tab-options-card-border)] pt-4">
        <BlockHeader icon={SlidersHorizontal} title={t('pref.defaultsTitle')} description={t('pref.defaultsDesc')} />
        <div className="mt-4 space-y-2">
          <Row title={t('pref.includeCover')} hint={t('pref.includeCoverHint')} on={defaults.includeCover} onClick={() => toggleDefault('includeCover')} />
          <Row title={t('pref.snapshot')} hint={t('pref.snapshotHint')} on={defaults.snapshot} onClick={() => toggleDefault('snapshot')} />
          <Row title={t('pref.defaultIsPrivate')} hint={t('pref.defaultIsPrivateHint')} on={defaults.defaultIsPrivate} onClick={() => toggleDefault('defaultIsPrivate')} />
        </div>
      </div>
      <Flash msg={msg} className="mt-3" />
    </div>
  )
}

function ThemeBtn({ value, current, label, onClick }: { value: Theme; current: Theme; label: string; onClick: (v: Theme) => void }) {
  return (
    <button type="button" aria-label={label} aria-pressed={current === value} onClick={() => onClick(value)} className={cn(`rounded-lg px-3 py-1.5 transition-colors ${current === value ? 'bg-[var(--tab-options-button-primary-bg)] text-[var(--tab-options-button-primary-text)] shadow' : 'hover:text-[var(--tab-options-title)]'}`)}>{label}</button>
  )
}
