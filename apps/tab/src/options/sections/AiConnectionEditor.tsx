import { useState } from 'react'
import { Eye, EyeOff } from 'lucide-react'
import { builtInBaseUrl, fetchAIModels, findPreset, saveAIConnection, testAIConnection, validateCustomBaseUrl, type ProviderPreset } from '@tmarks/ai'
import { isLoopbackHostname } from '../../lib/api/config'
import { useI18n } from '../../lib/i18n'
import { Button } from '../../lib/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../lib/ui/select'
import { Field } from '../../lib/ui/field'
import { Input } from '../../lib/ui/input'

interface EditorProps {
  presets: ProviderPreset[]
  onSaved: () => void
  onCancel: () => void
  flash: (kind: 'ok' | 'err', text: string) => void
}

/**
 * 连接编辑器。预设(内置 + 远程清单合并)提供 protocol/baseUrl/默认模型快照;
 * 'custom' 是逃生口:手输任意 OpenAI 兼容端点(中转、私有部署、本地模型)。
 */
export function ConnectionEditor({ presets, onSaved, onCancel, flash }: EditorProps): React.ReactElement {
  const { t } = useI18n()
  const [provider, setProvider] = useState<string>('openai')
  const [apiKey, setApiKey] = useState('')
  const [model, setModel] = useState('')
  const [label, setLabel] = useState('')
  const [apiUrl, setApiUrl] = useState('')
  const [showKey, setShowKey] = useState(false)
  const [models, setModels] = useState<string[]>([])
  const [fetching, setFetching] = useState(false)
  const [testing, setTesting] = useState(false)
  const [saving, setSaving] = useState(false)

  const isCustom = provider === 'custom'
  const preset = isCustom ? null : findPreset(presets, provider)
  const resolvedBaseUrl = isCustom ? apiUrl.trim() : preset?.baseUrl ?? ''
  const resolvedProtocol = preset?.protocol ?? 'openai-compatible'
  /** 模型留空时用清单/预设的默认模型(而非全局兜底),否则清单新增服务商开箱即坏。 */
  const resolvedModel = model.trim() || preset?.defaultModel || undefined
  const canFetch = isCustom ? Boolean(apiUrl.trim()) : preset?.canFetchModels ?? false

  /** custom 手输地址校验:保存、测试、拉取模型三条路径共用(http 仅放行回环)。 */
  const customUrlErrorKey = (): string | null => {
    const result = validateCustomBaseUrl(apiUrl, isLoopbackHostname)
    if (result === 'required') return 'ai.apiUrlRequired'
    if (result === 'invalid') return 'ai.apiUrlInvalid'
    return null
  }

  const fetchModels = async () => {
    if (!canFetch || !apiKey.trim() || !resolvedBaseUrl || fetching) return
    if (isCustom) {
      const error = customUrlErrorKey()
      if (error) {
        flash('err', t(error))
        return
      }
    }
    setFetching(true)
    try {
      const list = await fetchAIModels(isCustom ? apiUrl.trim() : resolvedBaseUrl, apiKey.trim())
      setModels(list)
      flash('ok', t('ai.fetchOk', { count: list.length }))
    } catch {
      flash('err', t('ai.fetchFail'))
    } finally {
      setFetching(false)
    }
  }

  const handleTest = async () => {
    if (!apiKey.trim() || testing) return
    if (isCustom) {
      const error = customUrlErrorKey()
      if (error) {
        flash('err', t(error))
        return
      }
    }
    setTesting(true)
    try {
      const r = await testAIConnection({
        provider,
        protocol: resolvedProtocol,
        baseUrl: isCustom ? apiUrl.trim() : resolvedBaseUrl,
        apiKey: apiKey.trim(),
        model: resolvedModel,
      })
      if (r.ok) flash('ok', t('ai.testOk'))
      else flash('err', `${t('ai.testFail')}${r.error ? `: ${r.error}` : ''}`)
    } catch {
      flash('err', t('ai.testFail'))
    } finally {
      setTesting(false)
    }
  }

  const save = async () => {
    if (!apiKey.trim() || saving) {
      if (!apiKey.trim()) flash('err', t('ai.apiKeyRequired'))
      return
    }
    if (isCustom) {
      const error = customUrlErrorKey()
      if (error) {
        flash('err', t(error))
        return
      }
    }
    setSaving(true)
    try {
      await saveAIConnection({
        provider,
        protocol: resolvedProtocol,
        apiKey: apiKey.trim(),
        baseUrl: isCustom ? apiUrl.trim() : resolvedBaseUrl,
        model: resolvedModel,
        label: label.trim() || undefined,
      })
      flash('ok', t('ai.save'))
      onSaved()
    } catch {
      flash('err', t('ai.saveFail'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="mt-3 rounded-xl border border-[var(--tab-options-card-border)] p-4">
      <div className="grid gap-3">
        <Field label={t('ai.provider')}>
          {/* 模型名与候选列表是服务商作用域的:切换时必须清空,否则 A 的
              模型名会随 B 的连接保存(调用端 404)、A 的 datalist 建议残留。 */}
          <Select
            value={provider}
            onValueChange={(next) => {
              setProvider(next)
              setModel('')
              setModels([])
            }}
          >
            <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>
              {presets.map((item) => (
                <SelectItem key={item.id} value={item.id}>{item.label}</SelectItem>
              ))}
              <SelectItem value="custom">{t('ai.providerCustom')}</SelectItem>
            </SelectContent>
          </Select>
          {preset && (
            <p className="mt-1 flex items-center gap-1.5 text-xs leading-relaxed text-muted-foreground">
              <span className="truncate">{preset.baseUrl}</span>
              {preset.baseUrl !== builtInBaseUrl(preset.id) && (
                <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[0.625rem]">{t('ai.presetOverridden')}</span>
              )}
            </p>
          )}
        </Field>
        {isCustom && (
          <Field label={t('ai.apiUrl')}>
            <Input
              value={apiUrl}
              onChange={(e) => setApiUrl(e.target.value)}
              placeholder={t('ai.apiUrlPlaceholder')}
              className="w-full"
            />
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{t('ai.apiUrlHint')}</p>
          </Field>
        )}
        <Field label={t('ai.apiKey')}>
          <div className="flex gap-1.5">
            <Input value={apiKey} onChange={(e) => setApiKey(e.target.value)} type={showKey ? 'text' : 'password'} className="flex-1" />
            <button
              type="button"
              onClick={() => setShowKey((v) => !v)}
              disabled={saving || fetching || testing}
              className="shrink-0 rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
              title={showKey ? t('ai.hideKey') : t('ai.viewKey')}
            >
              {showKey ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
            </button>
          </div>
          <p className="mt-1 text-xs leading-relaxed text-warning">{t('ai.apiKeySecurityHint')}</p>
        </Field>
        <Field label={t('ai.model')}>
          <div className="flex gap-1.5">
            <Input
              value={model}
              onChange={(e) => setModel(e.target.value)}
              list="ai-models"
              placeholder={preset?.defaultModel ?? t('ai.modelPlaceholder')}
              className="flex-1"
            />
            {canFetch && (
              <Button variant="outline" size="sm" className="shrink-0" loading={fetching} onClick={() => void fetchModels()} disabled={saving || testing || !apiKey.trim()}>
                {fetching ? t('ai.fetchingModels') : t('ai.fetchModels')}
              </Button>
            )}
          </div>
          <datalist id="ai-models">{models.map((item) => <option key={item} value={item} />)}</datalist>
        </Field>
        <Field label={t('ai.label')}>
          <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder={t('ai.labelPlaceholder')} className="w-full" />
        </Field>
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="outline" size="sm" onClick={onCancel} disabled={saving || fetching || testing}>{t('ai.cancel')}</Button>
        <Button variant="outline" size="sm" loading={testing} onClick={() => void handleTest()} disabled={saving || fetching || !apiKey.trim()}>
          {t('ai.testConnection')}
        </Button>
        <Button variant="primary" size="sm" loading={saving} onClick={() => void save()} disabled={fetching || testing}>{t('ai.save')}</Button>
      </div>
    </div>
  )
}
