import { useEffect, useState } from 'react'
import { Eye, EyeOff, Plus, Sparkles, Trash2, Zap } from 'lucide-react'
import {
  BUILT_IN_PRESETS,
  deleteAIConnection,
  getAIConnections,
  getActiveAIConnection,
  providerLabel,
  saveAIConnection,
  type AIConnectionInfo,
  type ProviderPreset,
} from '@tmarks/ai'
import { useI18n } from '../../lib/i18n'
import { Button } from '../../lib/ui/button'
import { confirmDialog } from '../../lib/ui/confirm'
import { BlockHeader, SubHeader } from '../../lib/ui/section'
import { Flash, useFlash } from '../../lib/ui/flash'
import { loadProviderPresets } from '../../lib/ai/presets'
import { ConnectionEditor } from './AiConnectionEditor'

export function AiSection(): React.ReactElement | null {
  const { t } = useI18n()
  const [connections, setConnections] = useState<AIConnectionInfo[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [revealedId, setRevealedId] = useState<string | null>(null)
  const [presets, setPresets] = useState<ProviderPreset[]>(BUILT_IN_PRESETS)
  const { msg, flash } = useFlash()

  const reload = async () => {
    const list = await getAIConnections()
    const active = await getActiveAIConnection()
    setConnections(list)
    setActiveId(active?.id ?? null)
  }

  useEffect(() => {
    void reload().catch(() => flash('err', t('ai.operationFailed')))
    // 远程预设清单静默刷新(失败回退缓存/内置),不打扰连接列表。
    void loadProviderPresets().then(setPresets).catch(() => {})
  }, [])

  const handleActivate = async (connection: AIConnectionInfo) => {
    if (!connection.id || busyId) return
    setBusyId(connection.id)
    try {
      await saveAIConnection({ ...connection })
      await reload()
      flash('ok', t('ai.activated'))
    } catch {
      flash('err', t('ai.operationFailed'))
    } finally {
      setBusyId(null)
    }
  }

  const handleRemove = async (connection: AIConnectionInfo) => {
    if (!connection.id || busyId || !(await confirmDialog({ message: t('ai.deleteConfirm'), danger: true, confirmText: t('ai.delete'), cancelText: t('ai.cancel') }))) return
    setBusyId(connection.id)
    try {
      await deleteAIConnection(connection.id)
      if (revealedId === connection.id) setRevealedId(null)
      await reload()
      flash('ok', t('ai.deleted'))
    } catch {
      flash('err', t('ai.operationFailed'))
    } finally {
      setBusyId(null)
    }
  }

  const copyKey = async (connection: AIConnectionInfo) => {
    try {
      await navigator.clipboard.writeText(connection.apiKey)
      flash('ok', t('ai.keyCopied'))
    } catch {
      flash('err', t('ai.operationFailed'))
    }
  }

  return (
    <div>
      <BlockHeader icon={Sparkles} title={t('ai.title')} description={t('ai.description')} />
      <Flash msg={msg} className="mt-3" />

      <div className="mt-4">
        <SubHeader
          title={t('ai.connections')}
          action={
            <Button variant="outline" size="sm" onClick={() => setEditing(true)} disabled={editing || busyId !== null} leading={<Plus className="h-3.5 w-3.5" />}>
              {t('ai.addConnection')}
            </Button>
          }
        />
      </div>

      {editing && (
        <ConnectionEditor
          presets={presets}
          onSaved={async () => {
            setEditing(false)
            try {
              await reload()
            } catch {
              flash('err', t('ai.operationFailed'))
            }
          }}
          onCancel={() => setEditing(false)}
          flash={flash}
        />
      )}

      <ul className="mt-3 flex flex-col gap-2">
        {connections.length === 0 && !editing && (
          <li className="text-xs text-muted-foreground">{t('ai.noConnections')}</li>
        )}
        {connections.map((connection) => (
          <li key={connection.id} className="rounded-xl border border-[var(--tab-options-card-border)] p-3">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">{providerLabel(connection.provider)}</span>
                  {connection.model && <span className="text-xs text-muted-foreground">· {connection.model}</span>}
                  {connection.id === activeId && (
                    <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[0.625rem] text-primary">{t('ai.active')}</span>
                  )}
                </div>
                {connection.label && <p className="mt-0.5 truncate text-xs text-muted-foreground">{connection.label}</p>}
              </div>
              <div className="flex shrink-0 gap-1">
                <button
                  type="button"
                  onClick={() => setRevealedId((cur) => (cur === connection.id ? null : (connection.id ?? null)))}
                  disabled={busyId !== null}
                  className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
                  title={connection.id === revealedId ? t('ai.hideKey') : t('ai.viewKey')}
                >
                  {connection.id === revealedId ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                </button>
                {connection.id !== activeId && (
                  <button
                    type="button"
                    onClick={() => void handleActivate(connection)}
                    disabled={busyId !== null}
                    className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
                    title={t('ai.setActive')}
                  >
                    <Zap className="h-3.5 w-3.5" />
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => void handleRemove(connection)}
                  disabled={busyId !== null}
                  className="rounded-lg p-1.5 text-destructive hover:bg-destructive/10 disabled:opacity-50"
                  title={t('ai.delete')}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
            {connection.id === revealedId && (
              <div className="mt-2 flex items-start justify-between gap-2 rounded-lg bg-muted px-2 py-1.5">
                <code className="min-w-0 break-all font-mono text-[0.625rem] leading-relaxed">{connection.apiKey}</code>
                <button
                  type="button"
                  onClick={() => void copyKey(connection)}
                  className="shrink-0 text-xs text-[var(--tab-options-button-primary-bg)] transition-colors hover:underline"
                >
                  {t('ai.copyKey')}
                </button>
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}
