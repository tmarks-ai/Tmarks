import { cn } from '../../lib/utils/cn'
import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { AlertTriangle, ArrowDownToLine, Check, RefreshCw, X } from 'lucide-react'
import { db, type SyncQueueRecord } from '../../lib/db'
import { useI18n } from '../../lib/i18n'
import { sendMsg } from '../../lib/utils/sendMsg'
import { confirmDialog } from '../../lib/ui/confirm'
import { BlockHeader } from '../../lib/ui/section'
import { Flash, useFlash } from '../../lib/ui/flash'

/**
 * 同步审查区:列出 syncQueue 中 failed/conflict 项,提供重试 / 强制本地 / 接受远端。
 * 复用 message 总线(RETRY_SYNC_ITEM / FORCE_LOCAL_SYNC_ITEM / ACCEPT_REMOTE_SYNC_ITEM)。
 */
export function SyncReviewSection(): React.ReactElement | null {
  const { t } = useI18n()
  const { msg, flash } = useFlash()
  const [busyId, setBusyId] = useState<string | null>(null)

  const items = useLiveQuery(
    () => db.syncQueue.where('status').anyOf(['failed', 'conflict', 'exhausted']).toArray(),
    [],
    [] as SyncQueueRecord[]
  )

  const handleRetry = async (id: string) => {
    setBusyId(id)
    try {
      const r = await sendMsg<{ ok?: boolean; error?: string }>({ type: 'RETRY_SYNC_ITEM', id })
      if (r?.ok) flash('ok', t('syncReview.retried'))
      else flash('err', r?.error ?? t('syncReview.retryFail'))
    } catch {
      flash('err', t('syncReview.retryFail'))
    } finally {
      setBusyId(null)
    }
  }

  const handleForceLocal = async (id: string) => {
    // 强制本地会覆盖服务器副本且服务端无法拒绝,UI 上不可逆——与选项页其余
    // 破坏性操作(重置/清密钥/重同步)同规,先确认。
    if (!(await confirmDialog({ message: t('syncReview.forceConfirm'), danger: true, confirmText: t('syncReview.forceLocal'), cancelText: t('syncReview.cancel') }))) return
    setBusyId(id)
    try {
      const r = await sendMsg<{ ok?: boolean; error?: string }>({ type: 'FORCE_LOCAL_SYNC_ITEM', id })
      if (r?.ok) flash('ok', t('syncReview.forced'))
      else flash('err', r?.error ?? t('syncReview.forceFail'))
    } catch {
      flash('err', t('syncReview.forceFail'))
    } finally {
      setBusyId(null)
    }
  }

  const handleAcceptRemote = async (id: string) => {
    // 接受远端丢弃本地改动并删除队列项,UI 上不可逆——先确认。
    if (!(await confirmDialog({ message: t('syncReview.acceptConfirm'), danger: true, confirmText: t('syncReview.acceptRemote'), cancelText: t('syncReview.cancel') }))) return
    setBusyId(id)
    try {
      const r = await sendMsg<{ ok?: boolean; error?: string }>({ type: 'ACCEPT_REMOTE_SYNC_ITEM', id })
      if (r?.ok) flash('ok', t('syncReview.accepted'))
      else flash('err', r?.error ?? t('syncReview.acceptFail'))
    } catch {
      flash('err', t('syncReview.acceptFail'))
    } finally {
      setBusyId(null)
    }
  }

  if (!items || items.length === 0) {
    return (
      <div>
        <BlockHeader icon={AlertTriangle} title={t('syncReview.title')} />
        <p className="mt-4 text-sm text-muted-foreground">{t('syncReview.empty')}</p>
      </div>
    )
  }

  return (
    <div>
      <BlockHeader icon={AlertTriangle} title={t('syncReview.title')} description={t('syncReview.description')} />
      <Flash msg={msg} className="mt-3" />
      <ul className="mt-4 flex flex-col gap-2">
        {items.map((item) => (
          <li key={item.id} className="rounded-xl border border-[var(--tab-options-card-border)] p-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  {item.status === 'conflict' ? (
                    <AlertTriangle className="h-4 w-4 text-warning" />
                  ) : (
                    <X className="h-4 w-4 text-destructive" />
                  )}
                  <span className="text-sm font-medium">{t(`syncReview.entity.${item.entity_type}`)}</span>
                  <span className="text-xs text-muted-foreground">· {t(`syncReview.operation.${item.operation}`)}</span>
                  {item.status === 'exhausted' && (
                    <span className="rounded-full bg-destructive/10 px-2 py-0.5 text-[11px] text-destructive">
                      {t('syncReview.exhausted')}
                    </span>
                  )}
                </div>
                <p className="mt-1 truncate text-xs text-muted-foreground" title={item.entity_id}>
                  {item.error_code ? `${item.error_code}: ` : ''}
                  {item.error_message ?? item.entity_id}
                </p>
                {item.error_code === 'INVALID_PARENT_TREE' && (
                  <p className="mt-1 text-xs text-muted-foreground">{t('syncReview.invalidParentTreeHint')}</p>
                )}
              </div>
              <div className="flex shrink-0 gap-1">
                <button
                  type="button"
                  disabled={busyId === item.id}
                  onClick={() => void handleRetry(item.id)}
                  className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
                  title={t('syncReview.retry')}
                >
                  <RefreshCw className={cn(`h-4 w-4 ${busyId === item.id ? 'animate-spin' : ''}`)} />
                </button>
                <button
                  type="button"
                  disabled={busyId === item.id}
                  onClick={() => void handleForceLocal(item.id)}
                  className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
                  title={t('syncReview.forceLocal')}
                >
                  <Check className="h-4 w-4" />
                </button>
                {item.server_payload != null && (
                  <button
                    type="button"
                    disabled={busyId === item.id}
                    onClick={() => void handleAcceptRemote(item.id)}
                    className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
                    title={t('syncReview.acceptRemote')}
                  >
                    <ArrowDownToLine className="h-4 w-4" />
                  </button>
                )}
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}
