import { useState } from 'react'
import { Download, KeyRound } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ConfirmDialog } from '@/components/common/ConfirmDialog'
import { useApiKeys, useCreateApiKey, useRevokeApiKey } from '@/hooks/useApiKeys'
import { useBookmarks } from '@/hooks/useBookmarks'
import { bookmarksService } from '@/services/bookmarks'
import { exportBookmarksMarkdown, downloadBlob } from '@/lib/export-bookmarks'
import { useToastStore } from '@/stores/toastStore'
import { useTranslation } from 'react-i18next'
import { SectionHeader, SettingGroup } from './SettingPrimitives'
import type { TFunc } from './SettingsSections'
import type { ApiKeyDTO } from '@tmarks/contracts'

/** API 区:创建密钥 + 密钥列表(列表跨列)。 */
export function ApiSection({ t }: { t: TFunc }): React.ReactElement {
  const { data, isLoading, isError } = useApiKeys()
  const create = useCreateApiKey()
  const revoke = useRevokeApiKey()
  const [newKey, setNewKey] = useState<string | null>(null)
  const [revokeTarget, setRevokeTarget] = useState<ApiKeyDTO | null>(null)
  const createExtensionKey = async () => {
    const result = await create.mutateAsync({ name: 'TMarks Browser Extension', template: 'FULL' })
    setNewKey(result.key)
  }
  const statusLabel = (status: ApiKeyDTO['status']) =>
    status === 'active' ? t('api.statusActive')
      : status === 'revoked' ? t('api.statusRevoked')
      : t('api.statusExpired')
  return (
    <div className="space-y-5">
      <SectionHeader title={t('tabs.api')} description={t('api.description')} icon={KeyRound} />
      <div className="grid gap-4 lg:grid-cols-2">
        <SettingGroup icon={KeyRound} title={t('api.createTitle')}>
          <div className="space-y-3">
            <Button size="sm" onClick={() => void createExtensionKey().catch(() => {})} disabled={create.isPending}>+ {t('api.createKey')}</Button>
            {newKey && (
              <div className="rounded-lg border border-primary/40 bg-primary/5 p-3 text-sm">
                <p className="font-medium">{t('api.newKey')}</p>
                <code className="mt-2 block break-all text-xs">{newKey}</code>
              </div>
            )}
          </div>
        </SettingGroup>
        {isLoading ? (
          <SettingGroup icon={KeyRound} title={t('api.keysTitle')}>
            <p className="text-sm text-muted-foreground">{t('api.loading')}</p>
          </SettingGroup>
        ) : isError ? (
          <SettingGroup icon={KeyRound} title={t('api.keysTitle')}>
            <p className="text-sm text-destructive">{t('api.loadFailed')}</p>
          </SettingGroup>
        ) : data?.keys && data.keys.length > 0 ? (
          <SettingGroup icon={KeyRound} title={t('api.keysTitle')} className="lg:col-span-2">
            <ul className="space-y-2">
              {data.keys.map((k) => (
                <li key={k.id} className="flex items-center justify-between gap-3 rounded-lg border border-border/60 p-3">
                  <div className="min-w-0">
                    <span className="text-sm font-medium">{k.name}</span>
                    <span className="ml-2 text-xs text-muted-foreground">{k.key_prefix}...</span>
                    <Badge
                      variant={k.status === 'active' ? 'secondary' : 'outline'}
                      className="ml-2"
                    >
                      {statusLabel(k.status)}
                    </Badge>
                  </div>
                  {/* 撤销只对生效中的密钥有意义;不可逆且立即断开扩展,须过确认框。 */}
                  {k.status === 'active' ? (
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={() => setRevokeTarget(k)}
                      disabled={revoke.isPending && revoke.variables === k.id}
                      showPendingIndicator
                    >
                      {t('action.revoke')}
                    </Button>
                  ) : null}
                </li>
              ))}
            </ul>
          </SettingGroup>
        ) : (
          <SettingGroup icon={KeyRound} title={t('api.keysTitle')}>
            <p className="text-sm text-muted-foreground">{t('api.noKeys')}</p>
          </SettingGroup>
        )}
      </div>
      <ConfirmDialog
        isOpen={Boolean(revokeTarget)}
        title={t('action.revoke')}
        message={t('api.revokeConfirm', { name: revokeTarget?.name ?? '' })}
        confirmText={t('action.revoke')}
        type="danger"
        onConfirm={() => {
          if (revokeTarget) revoke.mutate(revokeTarget.id)
          setRevokeTarget(null)
        }}
        onCancel={() => setRevokeTarget(null)}
      />
    </div>
  )
}

/** 数据区:导出 Markdown 书签(标题不与分组重复)。 */
export function DataSection({ t }: { t: TFunc }): React.ReactElement {
  const { data: bookmarkData, isLoading, isError } = useBookmarks()
  const { t: tc } = useTranslation('common')
  const toast = useToastStore.getState()
  const [exporting, setExporting] = useState(false)
  // R8 WE-6: meta.count 是当前页的行数(服务端分页默认 100),不是总数——
  // 大库会永远显示"100 条可用"。导出本身走全量游标,不受此影响;
  // 这里只报告已加载到缓存的规模,并如实标注"已加载"。
  const displayCount = bookmarkData?.bookmarks?.length ?? 0
  const handleExport = async () => {
    setExporting(true)
    try {
      const allBookmarks = await bookmarksService.getAllBookmarks()
      const blob = exportBookmarksMarkdown(allBookmarks, 'TMarks Export')
      downloadBlob(blob, `tmarks-bookmarks-${new Date().toISOString().slice(0, 10)}.md`)
    } catch {
      toast.error(tc('message.operationFailed'))
    } finally {
      setExporting(false)
    }
  }
  return (
    <div className="space-y-5">
      <SectionHeader title={t('tabs.data')} description={t('data.exportFeature.description')} icon={Download} />
      <SettingGroup>
        <div className="flex items-center gap-3">
          <Button size="sm" onClick={() => void handleExport()} disabled={exporting || isLoading || isError || displayCount === 0}><Download className="h-4 w-4" /> {t('data.export.title')}</Button>
          <span className="text-xs text-muted-foreground">
            {isError ? t('data.loadFailed') : isLoading ? t('data.loading') : t('data.bookmarksAvailable', { count: displayCount })}
          </span>
        </div>
      </SettingGroup>
    </div>
  )
}
