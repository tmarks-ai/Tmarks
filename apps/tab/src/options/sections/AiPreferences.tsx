import { useEffect, useMemo, useState } from 'react'
import { ChevronDown, ChevronUp, Eye, EyeOff, Tags } from 'lucide-react'
import { buildSingleBookmarkPrompt, buildSystemPrompt, DEFAULT_PROMPT_TEMPLATE, getAIOrganizerSettings, saveAIOrganizerSettings, type AIOrganizerSettings } from '@tmarks/ai'
import { useI18n } from '../../lib/i18n'
import { Button } from '../../lib/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../lib/ui/select'
import { BlockHeader } from '../../lib/ui/section'
import { Field } from '../../lib/ui/field'
import { Input, inputClass } from '../../lib/ui/input'
import { cn } from '../../lib/ui/cn'
import { Flash, useFlash } from '../../lib/ui/flash'

const PREVIEW_SAMPLE_URL = 'https://cursor.com'

/** AI 分类偏好(标签整理):核心(语言/标签数/自定义提示)+ 高级(温度/标题长度/描述详略,默认折叠)
 *  + 只读「预览完整提示词」(system 锁定契约 + user 请求变量,随设置实时变化)。
 *  独立 tmarks 段卡,属"AI"tab;复用 @tmarks/ai 的 organizer 设置存储。 */
export function AiPreferences(): React.ReactElement | null {
  const { t } = useI18n()
  const [settings, setSettings] = useState<AIOrganizerSettings | null>(null)
  const { msg, flash } = useFlash()
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [showPreview, setShowPreview] = useState(false)

  useEffect(() => {
    void getAIOrganizerSettings().then(setSettings).catch(() => flash('err', t('ai.operationFailed')))
  }, [])

  // 内置系统提示词(只读默认,作 placeholder 与"载入内置"起点)。
  const builtInSystem = useMemo(() => buildSystemPrompt(), [])
  // 只读预览:用示例 URL + 当前设置组装实际发给 AI 的 {system,user}。
  // 真实调用时 user 还会注入本地已有标签/目录,此处用空上下文演示结构与用户偏好的影响。
  const preview = useMemo(() => {
    if (!settings) return null
    return buildSingleBookmarkPrompt(PREVIEW_SAMPLE_URL, {
      language: settings.language === 'auto' ? undefined : settings.language,
      titleLength: settings.titleLength,
      descriptionDetail: settings.descriptionDetail,
      tagCount: settings.tagCount,
      tagStyle: settings.promptStyle,
      customSystemPrompt: settings.customSystemPrompt,
      existingTags: [],
      existingFolders: [],
    })
  }, [settings])

  const update = (patch: Partial<AIOrganizerSettings>) => {
    setSettings((prev) => (prev ? { ...prev, ...patch } : prev))
  }

  const save = async () => {
    if (!settings) return
    try {
      await saveAIOrganizerSettings(settings)
      flash('ok', t('ai.prefsSaved'))
    } catch {
      flash('err', t('ai.operationFailed'))
    }
  }

  if (!settings) return null

  return (
    <div>
      <BlockHeader icon={Tags} title={t('ai.preferences')} description={t('ai.preferencesDesc')} />
      <div className="mt-4 space-y-4">
        <Flash msg={msg} />

        {/* 核心:语言 + 标签数量 */}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('ai.language')}>
            <Select value={settings.language} onValueChange={(v) => update({ language: v as AIOrganizerSettings['language'] })}>
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="auto">{t('ai.lang.auto')}</SelectItem>
                <SelectItem value="zh">{t('ai.lang.zh')}</SelectItem>
                <SelectItem value="en">{t('ai.lang.en')}</SelectItem>
                <SelectItem value="mixed">{t('ai.lang.mixed')}</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label={t('ai.tagCount')}>
            <Input type="number" value={settings.tagCount} min={3} max={6} onChange={(e) => update({ tagCount: Number(e.target.value) })} className="w-full" />
          </Field>
        </div>

        {/* 核心:自定义提示词 */}
        <div>
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-foreground">{t('ai.promptStyle')}</span>
            <button type="button" onClick={() => update({ promptStyle: DEFAULT_PROMPT_TEMPLATE })} className="text-xs text-[var(--tab-options-button-primary-bg)] transition-colors hover:underline">
              {t('ai.promptStyleReset')}
            </button>
          </div>
          <textarea value={settings.promptStyle} onChange={(e) => update({ promptStyle: e.target.value })} rows={4} maxLength={1200} placeholder={DEFAULT_PROMPT_TEMPLATE} className={cn(inputClass, 'mt-1.5 w-full')} />
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{t('ai.promptStyleHint')}</p>
        </div>

        {/* 高级(折叠) */}
        <div>
          <button type="button" onClick={() => setShowAdvanced((v) => !v)} className="flex items-center gap-1 text-xs font-medium text-muted-foreground transition-colors hover:text-[var(--tab-options-title)]">
            {showAdvanced ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
            {t('ai.advanced')}
          </button>
          {showAdvanced && (
            <div className="mt-3 grid gap-3 sm:grid-cols-3">
              <Field label={t('ai.temperature')}>
                <Input type="number" value={settings.temperature} min={0} max={1} step={0.1} onChange={(e) => update({ temperature: Number(e.target.value) })} className="w-full" />
              </Field>
              <Field label={t('ai.titleLength')}>
                <Select value={settings.titleLength} onValueChange={(v) => update({ titleLength: v as AIOrganizerSettings['titleLength'] })}>
                  <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="short">{t('ai.len.short')}</SelectItem>
                    <SelectItem value="medium">{t('ai.len.medium')}</SelectItem>
                    <SelectItem value="long">{t('ai.len.long')}</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <Field label={t('ai.descriptionDetail')}>
                <Select value={settings.descriptionDetail} onValueChange={(v) => update({ descriptionDetail: v as AIOrganizerSettings['descriptionDetail'] })}>
                  <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="minimal">{t('ai.detail.minimal')}</SelectItem>
                    <SelectItem value="short">{t('ai.detail.short')}</SelectItem>
                    <SelectItem value="detailed">{t('ai.detail.detailed')}</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
            </div>
          )}
        </div>

        <div className="flex justify-end">
          <Button variant="primary" size="sm" onClick={() => void save()}>{t('ai.savePrefs')}</Button>
        </div>

        {/* 只读预览:实际发给 AI 的完整提示词 */}
        <div className="border-t border-[var(--tab-options-card-border)] pt-4">
          <button type="button" onClick={() => setShowPreview((v) => !v)} className="flex items-center gap-1 text-xs font-medium text-muted-foreground transition-colors hover:text-[var(--tab-options-title)]">
            {showPreview ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
            {t('ai.promptPreview')}
          </button>
          {showPreview && preview && (
            <div className="mt-3 space-y-3">
              <p className="text-xs leading-relaxed text-muted-foreground">{t('ai.promptPreviewHint')}</p>
              <div>
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-foreground">{t('ai.promptSystemLabel')}</span>
                  <button
                    type="button"
                    onClick={() => update({ customSystemPrompt: settings.customSystemPrompt ? '' : builtInSystem })}
                    className="text-xs text-[var(--tab-options-button-primary-bg)] transition-colors hover:underline"
                  >
                    {settings.customSystemPrompt ? t('ai.promptSystemReset') : t('ai.promptSystemLoad')}
                  </button>
                </div>
                <textarea
                  value={settings.customSystemPrompt}
                  onChange={(e) => update({ customSystemPrompt: e.target.value })}
                  rows={10}
                  maxLength={8000}
                  placeholder={builtInSystem}
                  className={cn(inputClass, 'mt-1.5 w-full resize-y font-mono text-xs leading-relaxed')}
                />
                <p className="mt-1 text-xs leading-relaxed text-warning">{t('ai.promptSystemWarn')}</p>
              </div>
              <Field label={t('ai.promptUserLabel')}>
                <textarea readOnly rows={8} value={preview.user} className={cn(inputClass, 'w-full resize-y font-mono text-xs leading-relaxed')} />
              </Field>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
