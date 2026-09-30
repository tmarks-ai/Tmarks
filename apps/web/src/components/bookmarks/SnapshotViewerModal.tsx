import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowLeft, Camera, Eye, Trash2 } from 'lucide-react'
import type { BookmarkSnapshotDTO } from '@tmarks/contracts'
import { useBookmarkSnapshots, useDeleteSnapshot } from '@/hooks/useSnapshots'
import { formatBookmarkDateTime } from './bookmarkDisplay'
import { snapshotsService } from '@/services/snapshots'
import { logger } from '@/lib/logger'
import { safeHttpUrl } from '@/lib/safe-url'
import { useToastStore } from '@/stores/toastStore'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ConfirmDialog } from '@/components/common/ConfirmDialog'

interface SnapshotViewerModalProps {
  bookmarkId: string
  title: string
  isOpen: boolean
  onClose: () => void
}

function formatSize(bytes: number): string {
  return `${Math.max(1, Math.round(bytes / 1024)).toString()} KB`
}

/** 书签快照查看器:列出历史快照,点击查看(只读 sandbox iframe),可删除。扩展创建快照存 R2,Web 在此查看。 */
export function SnapshotViewerModal({ bookmarkId, title, isOpen, onClose }: SnapshotViewerModalProps) {
  const { t, i18n } = useTranslation('bookmarks')
  const { t: tc } = useTranslation('common')
  const toast = useToastStore.getState()
  const query = useBookmarkSnapshots(isOpen ? bookmarkId : null)
  const deleteSnapshot = useDeleteSnapshot()

  const [viewing, setViewing] = useState<BookmarkSnapshotDTO | null>(null)
  const [blobUrl, setBlobUrl] = useState<string | null>(null)
  const [loadingHtml, setLoadingHtml] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<BookmarkSnapshotDTO | null>(null)
  // Sequence guard: 快速连点两个快照时,先发的 readHtml 后到会覆盖后发的
  // blob(界面显示 B、内容是 A)。每次 view/back/close 自增,过期响应丢弃。
  const viewSeq = useRef(0)

  // Reset viewer when modal closes / bookmark switches.
  useEffect(() => {
    if (!isOpen) {
      viewSeq.current += 1
      setViewing(null)
      setDeleteTarget(null)
      setLoadingHtml(false)
    }
  }, [isOpen])

  // Revoke object URL on cleanup / switch.
  useEffect(() => {
    return () => {
      if (blobUrl) URL.revokeObjectURL(blobUrl)
    }
  }, [blobUrl])

  const handleView = async (snapshot: BookmarkSnapshotDTO) => {
    const seq = ++viewSeq.current
    setViewing(snapshot)
    setLoadingHtml(true)
    if (blobUrl) URL.revokeObjectURL(blobUrl)
    setBlobUrl(null)
    try {
      const html = await snapshotsService.readHtml(bookmarkId, snapshot.id)
      if (seq !== viewSeq.current) return
      const url = URL.createObjectURL(new Blob([html], { type: 'text/html' }))
      setBlobUrl(url)
    } catch (error) {
      if (seq !== viewSeq.current) return
      logger.error('Failed to load snapshot html:', error)
      toast.error(t('snapshots.loadFailed'))
      setViewing(null)
    } finally {
      if (seq === viewSeq.current) setLoadingHtml(false)
    }
  }

  const handleBack = () => {
    viewSeq.current += 1
    setViewing(null)
    setLoadingHtml(false)
    if (blobUrl) URL.revokeObjectURL(blobUrl)
    setBlobUrl(null)
  }

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return
    const target = deleteTarget
    try {
      await deleteSnapshot.mutateAsync({ bookmarkId, snapshotId: target.id })
      if (viewing?.id === target.id) handleBack()
      setDeleteTarget(null)
      toast.success(t('snapshots.delete'))
    } catch (error) {
      logger.error('Failed to delete snapshot:', error)
      toast.error(t('message.operationFailed'))
    }
  }

  const formatDate = (value: string) => formatBookmarkDateTime(value, i18n.language)

  const snapshots = query.data?.snapshots ?? []

  return (
    <>
      <Dialog open={isOpen} onOpenChange={(open) => { if (!open) onClose() }}>
        <DialogContent className="max-w-3xl" closeLabel={tc('button.close')}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Camera className="h-4 w-4" />
              {t('snapshots.title')}
              <span className="truncate text-sm font-normal text-muted-foreground">{title}</span>
            </DialogTitle>
            <DialogDescription>{t('snapshots.title')}</DialogDescription>
          </DialogHeader>

          <div className="min-h-[320px]">
            {viewing ? (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Button variant="ghost" size="sm" onClick={handleBack}>
                    <ArrowLeft className="h-4 w-4" /> {t('snapshots.back')}
                  </Button>
                  {safeHttpUrl(viewing.source_url) ? (
                  <a
                    href={safeHttpUrl(viewing.source_url)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-primary hover:underline"
                  >
                    {t('snapshots.openOriginal')}
                  </a>
                ) : (
                  <span className="text-xs text-muted-foreground">{t('snapshots.openOriginal')}</span>
                )}
                </div>
                {loadingHtml ? (
                  <div className="flex h-72 items-center justify-center text-sm text-muted-foreground">
                    {t('snapshots.viewing')}
                  </div>
                ) : blobUrl ? (
                  <iframe
                    src={blobUrl}
                    sandbox=""
                    title={viewing.snapshot_title}
                    className="h-[60vh] w-full rounded-lg border border-border"
                  />
                ) : null}
              </div>
            ) : query.isLoading ? (
              <div className="flex h-72 items-center justify-center text-sm text-muted-foreground">{t('snapshots.loading')}</div>
            ) : query.isError ? (
              <div className="flex h-72 flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
                <p>{t('snapshots.loadFailed')}</p>
                <Button variant="outline" size="sm" onClick={() => query.refetch()}>{tc('button.retry')}</Button>
              </div>
            ) : snapshots.length === 0 ? (
              <div className="flex h-72 flex-col items-center justify-center gap-1 text-muted-foreground/70">
                <Camera className="h-8 w-8" />
                <p className="text-sm font-medium text-foreground">{t('snapshots.empty')}</p>
                <p className="text-xs">{t('snapshots.emptyHint')}</p>
              </div>
            ) : (
              <div className="max-h-[60vh] space-y-1.5 overflow-y-auto">
                {snapshots.map((snapshot) => (
                  <div
                    key={snapshot.id}
                    className="flex items-center gap-3 rounded-lg border border-border/60 p-2.5 transition-colors hover:bg-muted/40"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="text-sm font-medium text-foreground">
                          {t('snapshots.version', { version: snapshot.version })}
                        </span>
                        {snapshot.is_latest && <Badge variant="secondary" className="text-[10px]">{t('snapshots.latest')}</Badge>}
                      </div>
                      <p className="truncate text-xs text-muted-foreground">{snapshot.snapshot_title}</p>
                      <p className="text-[10px] text-muted-foreground/70">
                        {formatDate(snapshot.created_at)} · {t('snapshots.size', { size: formatSize(snapshot.content_size) })}
                      </p>
                    </div>
                    <Button variant="ghost" size="sm" onClick={() => handleView(snapshot)} aria-label={t('snapshots.view')}>
                      <Eye className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-destructive hover:text-destructive"
                      onClick={() => setDeleteTarget(snapshot)}
                      aria-label={t('snapshots.delete')}
                      disabled={deleteSnapshot.isPending}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        isOpen={Boolean(deleteTarget)}
        title={t('snapshots.delete')}
        message={t('snapshots.deleteConfirm')}
        confirmText={t('snapshots.delete')}
        type="danger"
        isSubmitting={deleteSnapshot.isPending}
        onConfirm={handleConfirmDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </>
  )
}
