import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AlertTriangle, ArrowLeft, Trash2 } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { bookmarksService } from '@/services/bookmarks'
import { useEmptyTrash, usePermanentDelete, useRestoreFromTrash } from '@/hooks/useBookmarks'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'
import { logger } from '@/lib/logger'
import { useToastStore } from '@/stores/toastStore'
import type { TrashResponse } from '@tmarks/contracts'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/common/ConfirmDialog'
import { TrashBookmarkItem } from './TrashBookmarkItem'

interface ConfirmState {
  title: string
  message: string
  confirmText: string
  type: 'default' | 'danger'
  onConfirm: () => Promise<void>
}

async function getAllTrashedBookmarks(): Promise<TrashResponse> {
  const bookmarks: TrashResponse['bookmarks'] = []
  let pageCursor: string | undefined
  let meta: TrashResponse['meta'] | null = null

  do {
    const page = await bookmarksService.getTrash({ page_size: 100, page_cursor: pageCursor })
    bookmarks.push(...page.bookmarks)
    meta = page.meta
    pageCursor = page.meta.has_more ? page.meta.next_cursor ?? undefined : undefined
  } while (pageCursor)

  return {
    bookmarks,
    meta: {
      total: meta?.total ?? bookmarks.length,
      page_size: 100,
      has_more: false,
      next_cursor: null,
    },
  }
}

/** 书签回收站:列出/恢复/彻底删/清空。挂 AppShell(流式 padding)。 */
export function BookmarkTrashPage() {
  const { t } = useTranslation('bookmarks')
  useDocumentTitle(t('trash.title'))
  const [confirm, setConfirm] = useState<ConfirmState | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const toast = useToastStore.getState()

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['bookmarks', 'trash'],
    queryFn: getAllTrashedBookmarks,
    staleTime: 60 * 1000,
  })
  const bookmarks = data?.bookmarks ?? []

  const restoreMutation = useRestoreFromTrash()
  const permanentDeleteMutation = usePermanentDelete()
  const emptyTrashMutation = useEmptyTrash()

  const run = async (fn: () => Promise<unknown>, successMessage: string) => {
    setSubmitting(true)
    try {
      await fn()
      toast.success(successMessage)
      setConfirm(null)
    } catch (error) {
      logger.error('Trash action failed:', error)
    } finally {
      setSubmitting(false)
    }
  }

  const handleRestore = (id: string, title: string) => {
    setConfirm({
      title: t('trash.restoreTitle'),
      message: t('trash.restoreMessage', { title }),
      confirmText: t('trash.confirm'),
      type: 'default',
      onConfirm: () => run(() => restoreMutation.mutateAsync(id), t('trash.restoreSuccess')),
    })
  }

  const handlePermanentDelete = (id: string, title: string) => {
    setConfirm({
      title: t('trash.permanentDeleteTitle'),
      message: t('trash.permanentDeleteMessage', { title }),
      confirmText: t('trash.confirmDelete'),
      type: 'danger',
      onConfirm: () => run(() => permanentDeleteMutation.mutateAsync(id), t('trash.permanentDeleteSuccess')),
    })
  }

  const handleEmptyTrash = () => {
    if (bookmarks.length === 0) return
    setConfirm({
      title: t('trash.emptyTrashTitle'),
      message: t('trash.emptyTrashMessage', { count: bookmarks.length }),
      confirmText: t('trash.confirmDelete'),
      type: 'danger',
      onConfirm: () => run(() => emptyTrashMutation.mutateAsync(), t('trash.emptyTrashSuccess', { count: bookmarks.length })),
    })
  }

  if (isLoading) {
    return <div className="flex items-center justify-center py-24 text-muted-foreground">{t('trash.loading')}</div>
  }
  if (isError) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <p className="mb-4 text-destructive">{t('trash.loadFailed')}</p>
        <Button variant="outline" onClick={() => refetch()}>{t('trash.retry')}</Button>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-5xl py-6">

      <h1 className="sr-only">{t('trash.title')}</h1>      <div className="mb-6">
        <Link to="/" className="mb-4 inline-flex items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground">
          <ArrowLeft className="h-4 w-4" />
          <span>{t('trash.backToBookmarks')}</span>
        </Link>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="mb-2 flex items-center gap-3">
              <Trash2 className="h-7 w-7 text-muted-foreground" />
              <h1 className="text-2xl font-bold text-foreground">{t('trash.title')}</h1>
            </div>
          </div>
          {bookmarks.length > 0 && (
            <Button
              variant="destructive"
              className="w-full sm:w-auto"
              onClick={handleEmptyTrash}
              disabled={submitting}
              aria-busy={submitting}
            >
              <Trash2 className="h-4 w-4" />
              {t('trash.emptyTrash')}
            </Button>
          )}
        </div>
      </div>

      {bookmarks.length === 0 ? (
        <div className="py-16 text-center">
          <Trash2 className="mx-auto mb-4 h-16 w-16 text-muted-foreground/30" />
          <h3 className="mb-2 text-lg font-medium text-foreground">{t('trash.emptyState.title')}</h3>
          <p className="text-sm text-muted-foreground">{t('trash.emptyState.description')}</p>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex items-start gap-3 rounded-lg border border-amber-500/20 bg-amber-500/10 p-4">
            <AlertTriangle className="mt-0.5 h-5 w-5 flex-shrink-0 text-amber-600 dark:text-amber-400" />
            <p className="text-sm text-muted-foreground">{t('trash.warning')}</p>
          </div>
          {bookmarks.map((bookmark) => (
            <TrashBookmarkItem
              key={bookmark.id}
              bookmark={bookmark}
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
