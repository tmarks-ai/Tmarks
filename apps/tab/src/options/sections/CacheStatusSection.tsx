import { useLiveQuery } from 'dexie-react-hooks'
import { Database } from 'lucide-react'
import { db } from '../../lib/db'
import { formatTime } from '../../lib/format'
import { useI18n } from '../../lib/i18n'
import { BlockHeader } from '../../lib/ui/section'

/** 缓存状态卡:3 指标(标签/书签/最近同步,用 cache-metric emerald/blue/slate 色卡)+ 失败计数提示。
 *  数据接 Dexie live query;同步控件统一归 SettingsSection,本卡仅展示。 */
export function CacheStatusSection() {
  const { t } = useI18n()
  const bookmarks = useLiveQuery(() => db.bookmarks.filter((b) => !b.deleted_at).count(), [], 0)
  const tags = useLiveQuery(() => db.tags.filter((tag) => tag.pending_op !== 'delete').count(), [], 0)
  const failed = useLiveQuery(() => db.syncQueue.where('status').anyOf(['failed', 'conflict', 'exhausted']).count(), [], 0)
  const syncState = useLiveQuery(() => db.syncState.get('singleton'), [])
  const lastSync = syncState?.last_sync_at ?? null

  return (
    <div>
      <BlockHeader icon={Database} title={t('options.cacheTitle')} description={t('options.cacheDesc')} />
      <div className="mt-4 space-y-3">
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-xl border border-[var(--tab-options-cache-metric-blue-border)] bg-[var(--tab-options-cache-metric-blue-bg)] p-3 text-center">
            <p className="text-2xl font-bold text-[var(--tab-options-cache-metric-blue-value)]">{tags}</p>
            <p className="mt-1 text-xs uppercase tracking-wide text-[var(--tab-options-cache-metric-blue-label)]">{t('options.tagsCount')}</p>
          </div>
          <div className="rounded-xl border border-[var(--tab-options-cache-metric-emerald-border)] bg-[var(--tab-options-cache-metric-emerald-bg)] p-3 text-center">
            <p className="text-2xl font-bold text-[var(--tab-options-cache-metric-emerald-value)]">{bookmarks}</p>
            <p className="mt-1 text-xs uppercase tracking-wide text-[var(--tab-options-cache-metric-emerald-label)]">{t('options.bookmarksCount')}</p>
          </div>
          <div className="rounded-xl border border-[var(--tab-options-cache-metric-slate-border)] bg-[var(--tab-options-cache-metric-slate-bg)] p-3 text-center">
            <p className="text-xs font-medium text-[var(--tab-options-cache-metric-slate-value)]">{formatTime(lastSync)}</p>
            <p className="mt-1 text-xs uppercase tracking-wide text-[var(--tab-options-cache-metric-slate-label)]">{t('options.lastSync')}</p>
          </div>
        </div>

        {failed > 0 && (
          <div className="rounded-xl border border-[var(--tab-options-danger-border)] bg-[var(--tab-options-danger-bg)] p-3 text-center">
            <p className="text-sm font-semibold text-[var(--tab-options-danger-text)]">{t('options.failedCount', { count: failed })}</p>
            <p className="mt-0.5 text-xs text-[var(--tab-options-danger-text)]">{t('options.failedHint')}</p>
          </div>
        )}
      </div>
    </div>
  )
}
