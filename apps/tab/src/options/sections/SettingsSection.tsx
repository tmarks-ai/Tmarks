import { useEffect, useState, type FormEvent } from 'react'
import { Pause, Play, Plug, RefreshCw, RotateCw } from 'lucide-react'
import { setApiOrigin } from '../../lib/api/config'
import { type SyncStateRecord } from '../../lib/db'
import { saveSyncState } from '../../lib/db/sync-state'
import { syncModeLabel, formatTime } from '../../lib/format'
import { useI18n } from '../../lib/i18n'
import { sendMsg } from '../../lib/utils/sendMsg'
import { Button } from '../../lib/ui/button'
import { confirmDialog } from '../../lib/ui/confirm'
import { BlockHeader } from '../../lib/ui/section'
import { Field } from '../../lib/ui/field'
import { Input } from '../../lib/ui/input'
import { Flash, useFlash } from '../../lib/ui/flash'

interface Props {
  origin: string
  syncState: SyncStateRecord | null
  authed: boolean
  reload: () => Promise<void>
}

interface SyncResp {
  pushed?: number
  pulled?: number
  mode?: string
  error?: string
}

/** 连接与同步区:API 地址 + 同步模式/暂停/立即同步/重新全量同步。 */
export function SettingsSection({ origin, syncState, authed, reload }: Props) {
  const { t } = useI18n()
  const [originInput, setOriginInput] = useState(origin)
  const [busy, setBusy] = useState('')
  const { msg, flash } = useFlash()

  useEffect(() => {
    setOriginInput(origin)
  }, [origin])

  const paused = syncState?.mode === 'paused'
  const mode = syncState?.mode ?? 'local_only'
  const lastSync = syncState?.last_sync_at ?? null

  // 401/403 静默降级修正:本地还存着 key 但被服务器拒绝时,同步结果会带
  // mode='local_only' 而不带 error——此时绝不能弹"同步完成"绿条,否则数据
  // 实际未同步、队列持续积压,用户却以为一切正常。authed 门控:未配置 key
  // 时 local_only 是正确状态(如从暂停恢复)。
  const isForbiddenDegraded = (r: SyncResp | null | undefined): boolean =>
    authed && Boolean(r) && !r!.error && r!.mode === 'local_only'

  const handleSaveOrigin = async (e: FormEvent) => {
    e.preventDefault()
    const v = originInput.trim()
    if (!v || v === origin) return
    try {
      new URL(v)
    } catch {
      flash('err', t('settings.toast.originInvalid'))
      return
    }
    setBusy('origin')
    try {
      await setApiOrigin(v)
      await reload()
      flash('ok', t('settings.toast.originSaved'))
    } catch {
      flash('err', t('settings.toast.originSaveFail'))
    } finally {
      setBusy('')
    }
  }

  const handleTogglePause = async () => {
    if (busy) return
    setBusy('pause')
    try {
      if (paused) {
        await saveSyncState({ mode: 'local_only' })
        const r = await sendMsg<SyncResp>({ type: 'SYNC_NOW' })
        if (!r || r.error) flash('err', r?.error ?? t('settings.toast.syncFail'))
        else if (isForbiddenDegraded(r)) flash('err', t('settings.toast.syncForbidden'))
        else flash('ok', t('settings.toast.resumed'))
      } else {
        await saveSyncState({ mode: 'paused' })
        flash('ok', t('settings.toast.paused'))
      }
      await reload()
    } catch {
      flash('err', t('settings.toast.syncFail'))
    } finally {
      setBusy('')
    }
  }

  const handleSyncNow = async () => {
    setBusy('sync')
    try {
      const r = await sendMsg<SyncResp>({ type: 'SYNC_NOW' })
      if (!r || r.error) flash('err', r?.error ?? t('settings.toast.syncFail'))
      else if (isForbiddenDegraded(r)) flash('err', t('settings.toast.syncForbidden'))
      else flash('ok', t('settings.toast.syncOk', { pushed: r.pushed ?? 0, pulled: r.pulled ?? 0 }))
      await reload()
    } catch {
      flash('err', t('settings.toast.syncFail'))
    } finally {
      setBusy('')
    }
  }

  const handleResync = async () => {
    if (!(await confirmDialog({ message: t('settings.resyncConfirm'), danger: true, confirmText: t('settings.resync') }))) return
    setBusy('resync')
    try {
      const r = await sendMsg<SyncResp>({ type: 'RESYNC' })
      if (!r || r.error) flash('err', r?.error ?? t('settings.toast.resyncFail'))
      else if (isForbiddenDegraded(r)) flash('err', t('settings.toast.syncForbidden'))
      else flash('ok', t('settings.toast.resyncOk', { pushed: r.pushed ?? 0, pulled: r.pulled ?? 0 }))
      await reload()
    } catch {
      flash('err', t('settings.toast.resyncFail'))
    } finally {
      setBusy('')
    }
  }

  return (
    <div>
      <BlockHeader icon={Plug} title={t('settings.title')} description={t('settings.description')} />
      <form onSubmit={handleSaveOrigin} className="mt-4">
        <Field label={t('settings.apiOrigin')}>
          <div className="flex gap-2">
            <Input
              value={originInput}
              onChange={(e) => setOriginInput(e.target.value)}
              placeholder="http://localhost:8787"
              className="flex-1"
            />
            <Button type="submit" variant="outline" loading={busy === 'origin'} disabled={originInput === origin}>{t('settings.save')}</Button>
          </div>
        </Field>
      </form>

      <div className="mt-4 flex flex-col gap-3 border-t border-[var(--tab-options-card-border)] pt-4 text-sm">
        <div className="flex items-center justify-between gap-2">
          <span className="text-muted-foreground">
            {syncModeLabel(mode)} · {formatTime(lastSync)}
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={handleTogglePause}
            loading={busy === 'pause'}
            leading={paused ? <Play className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />}
          >
            {paused ? t('settings.resume') : t('settings.pause')}
          </Button>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            className="flex-1"
            loading={busy === 'sync'}
            leading={busy === 'sync' ? undefined : <RefreshCw className="h-3.5 w-3.5" />}
            onClick={handleSyncNow}
            disabled={!authed}
            title={authed ? t('settings.syncNow') : t('settings.loginRequired')}
          >
            {t('settings.syncNow')}
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="flex-1"
            loading={busy === 'resync'}
            leading={busy === 'resync' ? undefined : <RotateCw className="h-3.5 w-3.5" />}
            onClick={handleResync}
            disabled={!authed}
            title={authed ? t('settings.resync') : t('settings.loginRequired')}
          >
            {t('settings.resync')}
          </Button>
        </div>
        <Flash msg={msg} />
      </div>
    </div>
  )
}
