import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowLeft, Folder, Trash2 } from 'lucide-react'
import { Link } from 'react-router-dom'
import {
  usePermanentDeleteTabGroup,
  useRestoreTabGroup,
  useTabGroupsTrashQuery,
} from '@/hooks/useTabGroups'
import { logger } from '@/lib/logger'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'
import { useToastStore } from '@/stores/toastStore'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/common/ConfirmDialog'
import { TrashTabGroupItem } from './TrashTabGroupItem'

interface ConfirmState {
  title: string
  message: string
  confirmText: string
  type: 'default' | 'danger'
  onConfirm: () => Promise<void>
}

/** 标签页组回收站:列出/恢复/永久删除。挂 AppShell(流式 padding)。 */
export function TabGroupsTrashPage() {
  const { t } = useTranslation('tabGroups')
  const [confirm, setConfirm] = useState<ConfirmState | null>(null)
  const [submitting, setSubmitting] = useState(false)
  useDocumentTitle(t('trash.title'))

  const { data, isLoading, isError, refetch } = useTabGroupsTrashQuery()
  const groups = data?.tab_groups ?? []
  const restoreMutation = useRestoreTabGroup()
  const permanentDeleteMutation = usePermanentDeleteTabGroup()
  const toast = useToastStore.getState()

  const run = async (fn: () => Promise<unknown>, successKey: string) => {
    setSubmitting(true)
    try {
      await fn()
      toast.success(t(successKey))
      setConfirm(null)
    } catch (error) {
      logger.error('Trash action failed:', error)
      // Mutation hooks already show an error toast via onError; avoid a duplicate.
    } finally {
      setSubmitting(false)
    }
  }

  const handleRestore = (id: string, title: string) => {
    setConfirm({
      title: t('confirm.restoreGroup'),
      message: t('confirm.restoreGroupMessage', { title }),
      confirmText: t('trash.restore'),
      type: 'default',
      onConfirm: () => run(() => restoreMutation.mutateAsync(id), 'message.restoreSuccess'),
    })
  }
  const handlePermanentDelete = (id: string, title: string) => {
    setConfirm({
      title: t('confirm.permanentDelete'),
      message: t('confirm.permanentDeleteMessage', { title }),
      confirmText: t('trash.deletePermanently'),
      type: 'danger',
      onConfirm: () => run(() => permanentDeleteMutation.mutateAsync(id), 'message.permanentDeleteSuccess'),
    })
  }

  if (isLoading) {
    return <div className="flex items-center justify-center py-24 text-muted-foreground">{t('page.loading')}</div>
  }
  if (isError) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <p className="mb-4 text-destructive">{t('page.loadFailed')}</p>
        <Button variant="outline" onClick={() => refetch()}>{t('page.retry')}</Button>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-5xl py-6">

      <h1 className="sr-only">{t('trash.title')}</h1>      <div className="mb-6">
        <Link to="/tab" className="mb-4 inline-flex items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground">
          <ArrowLeft className="h-4 w-4" />
          <span>{t('trash.backToTabGroups')}</span>
        </Link>
        <div className="flex items-center gap-3">
          <Trash2 className="h-7 w-7 text-muted-foreground" />
          <h1 className="text-2xl font-bold text-foreground">{t('trash.title')}</h1>
        </div>
      </div>
      {groups.length === 0 ? (
        <div className="py-16 text-center">
          <Folder className="mx-auto mb-4 h-16 w-16 text-muted-foreground/30" />
          <h3 className="mb-2 text-lg font-medium text-foreground">{t('trash.empty')}</h3>
        </div>
      ) : (
        <div className="space-y-4">
          {groups.map((group) => (
            <TrashTabGroupItem
              key={group.id}
              group={group}
              onRestore={handleRestore}
              onDelete={handlePermanentDelete}
            />
          ))}
        </div>
      )}
      <ConfirmDialog
        isOpen={Boolean(confirm)}
        title={confirm?.title ?? ''}
        message={confirm?.message ?? ''}
        confirmText={confirm?.confirmText}
        type={confirm?.type ?? 'default'}
        isSubmitting={submitting}
        onConfirm={() => { void confirm?.onConfirm() }}
        onCancel={() => setConfirm(null)}
      />
    </div>
  )
}
