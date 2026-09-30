import { Activity, RefreshCw, Database, Clock, Puzzle } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useSyncSummary, useTriggerSync } from '@/hooks/useSyncHealth'
import { useExtensionAvailable, useExtensionSyncStatus } from '@/hooks/useExtensionBridge'
import { useToastStore } from '@/stores/toastStore'
import type { TFunc } from './SettingsSections'
import { SectionHeader } from './SettingPrimitives'
import type { SyncEntitySummary } from '@/services/sync-health'

const ENTITY_KEYS = ['bookmarks', 'bookmark_folders', 'tags', 'tab_groups', 'tab_group_items'] as const

type EntityKey = (typeof ENTITY_KEYS)[number]

const SYNC_MODE_KEY = {
  local_only: 'syncHealth.card.modeLocalOnly',
  cloud_sync: 'syncHealth.card.modeCloudSync',
  paused: 'syncHealth.card.modePaused',
} as const

function formatTime(value: string | null, t: TFunc): string {
  if (!value) return t('syncHealth.table.never')
  try {
    return new Date(value).toLocaleString()
  } catch {
    return value
  }
}

export function SyncHealthSection({ t }: { t: TFunc }): React.ReactElement {
  const { data, isLoading, isError, refetch } = useSyncSummary()
  const triggerSync = useTriggerSync()
  const toast = useToastStore()
  const extensionAvailable = useExtensionAvailable()
  const extensionStatus = useExtensionSyncStatus(extensionAvailable === true)

  const entities = data?.entities
  const rows: Array<[EntityKey, SyncEntitySummary]> = ENTITY_KEYS.map((key) => [
    key,
    entities?.[key] ?? { count: 0, maxUpdatedAt: null },
  ])

  const totalCloud = rows.reduce((sum, [, e]) => sum + e.count, 0)
  const latestUpdate = rows
    .map(([, e]) => e.maxUpdatedAt)
    .filter((v): v is string => Boolean(v))
    .sort()
    .at(-1) ?? null

  const handleRefresh = () => {
    triggerSync.mutate(undefined, {
      onSuccess: () => toast.success(t('syncHealth.message.syncTriggered')),
      onError: () => toast.error(t('syncHealth.message.syncFailed')),
    })
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <SectionHeader title={t('tabs.sync-health')} description={t('syncHealth.description')} icon={Activity} />
        <Button size="sm" onClick={handleRefresh} disabled={triggerSync.isPending}>
          <RefreshCw className={triggerSync.isPending ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} />
          {triggerSync.isPending ? t('syncHealth.action.syncing') : t('syncHealth.action.triggerSync')}
        </Button>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm">
              <Database className="h-4 w-4" /> {t('syncHealth.card.cloud')}
            </CardTitle>
            <CardDescription>{t('syncHealth.card.cloudDesc')}</CardDescription>
          </CardHeader>
          <CardContent>
            {/* 加载失败时显示占位而非 0——否则错误被误读成"账号是空的"。 */}
            <p className="text-2xl font-semibold">{isLoading ? '…' : isError ? '—' : totalCloud}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm">
              <Clock className="h-4 w-4" /> {t('syncHealth.card.lastUpdate')}
            </CardTitle>
            <CardDescription>{t('syncHealth.card.lastUpdateDesc')}</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm font-medium">{isLoading ? '…' : isError ? '—' : formatTime(latestUpdate, t)}</p>
          </CardContent>
        </Card>
        {/* 扩展桥接状态:经 postMessage 探测并查询扩展本地同步状态(替换 Phase 1 占位)。 */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm">
              <Puzzle className="h-4 w-4" /> {t('syncHealth.card.extension')}
            </CardTitle>
            <CardDescription>
              {extensionAvailable === null
                ? t('syncHealth.card.extensionChecking')
                : extensionAvailable
                  ? t('syncHealth.card.extensionConnected')
                  : t('syncHealth.card.extensionNotDetected')}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {extensionAvailable === null ? (
              <Badge variant="muted">{t('syncHealth.card.extensionChecking')}</Badge>
            ) : !extensionAvailable ? (
              <Badge variant="muted">{t('syncHealth.card.extensionNotDetected')}</Badge>
            ) : extensionStatus.isLoading ? (
              <p className="text-sm text-muted-foreground">{t('syncHealth.card.extensionChecking')}</p>
            ) : extensionStatus.data ? (
              <div className="space-y-0.5 text-sm">
                <Badge variant="secondary">{t(SYNC_MODE_KEY[extensionStatus.data.syncMode])}</Badge>
                <p className="text-xs text-muted-foreground">
                  {t('syncHealth.card.extensionPendingOps', { count: extensionStatus.data.pendingOps })}
                </p>
                <p className="text-xs text-muted-foreground">
                  {extensionStatus.data.lastSyncAt
                    ? t('syncHealth.card.extensionLastSync', { time: formatTime(extensionStatus.data.lastSyncAt, t) })
                    : t('syncHealth.card.extensionNeverSynced')}
                </p>
              </div>
            ) : (
              <Badge variant="muted">{t('syncHealth.card.extensionStatusUnavailable')}</Badge>
            )}
          </CardContent>
        </Card>
      </div>

      {isError ? (
        <div className="flex items-center justify-center py-12 text-center">
          <div>
            <p className="mb-3 text-destructive">{t('syncHealth.message.syncFailed')}</p>
            <Button variant="outline" size="sm" onClick={() => void refetch()}>{t('syncHealth.action.triggerSync')}</Button>
          </div>
        </div>
      ) : (
      <div className="rounded-xl border border-border/60">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('syncHealth.table.entity')}</TableHead>
              <TableHead>{t('syncHealth.table.cloudCount')}</TableHead>
              <TableHead>{t('syncHealth.table.lastUpdate')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map(([key, e]) => (
              <TableRow key={key}>
                <TableCell className="font-medium">{t(`syncHealth.entity.${key}`)}</TableCell>
                <TableCell>{isLoading ? '…' : e.count}</TableCell>
                <TableCell className="text-muted-foreground">{isLoading ? '…' : formatTime(e.maxUpdatedAt, t)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      )}
    </div>
  )
}
