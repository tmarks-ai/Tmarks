import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import type { BookmarkSnapshotDTO } from '@tmarks/contracts'
import { db } from '../lib/db'
import { snapshotsApi } from '../lib/api/snapshots'
import { captureCurrentPage } from '../lib/services/snapshot-capture'
import { enqueueSnapshotUpload, pushSnapshots } from '../lib/services/snapshot-upload'
import { buildSnapshotViewerHtml } from '../lib/services/snapshot-viewer'
import type { LocalBookmark } from '../lib/db'
import type { TranslateFn } from '../lib/i18n'

interface Props {
  bookmark: LocalBookmark | null
  tabId: number | undefined
  notify: (level: 'success' | 'error', text: string) => void
  t: TranslateFn
}

interface BookmarkSnapshotsController {
  enabled: boolean
  setEnabled: (value: boolean) => void
  count: number
  /** 可查看=有服务端快照可打开(失败/exhausted 的本地上传件不可看)。 */
  viewable: boolean
  create: (bookmark: LocalBookmark) => Promise<boolean>
  openLatest: () => Promise<void>
  opening: boolean
}

/** 快照控制器:本地优先保存(create 即写本地,永不丢),异步排队上传 R2;失败由 alarm 退避重试。
 *  count = 服务端已上传数 + 本地待上传数 → 用户创建即时反馈。
 *  列表/删除/历史浏览归 Web 查看器;弹窗仅保留"查看最新快照"(开新标签页沙箱渲染)。 */
export function useBookmarkSnapshots({ bookmark, tabId, notify, t }: Props): BookmarkSnapshotsController {
  const [enabled, setEnabled] = useState(false)
  const [busyAction, setBusyAction] = useState<'create' | 'open' | null>(null)
  const [serverSnapshots, setServerSnapshots] = useState<BookmarkSnapshotDTO[]>([])
  const [serverTotal, setServerTotal] = useState(0)

  // 本地上传缓冲(pending/uploading/failed):useLiveQuery 订阅,上传成功删行即自动移除。
  const localUploads = useLiveQuery(
    () => db.snapshotUploads.where('bookmark_id').equals(bookmark?.id ?? '').toArray(),
    [bookmark?.id],
  ) ?? []

  useEffect(() => {
    let cancelled = false
    setEnabled(false)
    setServerSnapshots([])
    setServerTotal(0)
    if (!bookmark) return () => { cancelled = true }
    void snapshotsApi.list(bookmark.id).then((data) => {
      if (cancelled) return
      setServerTotal(data.total)
      setServerSnapshots(data.snapshots)
    }).catch(() => {
      // 快照不可用不应阻塞本地书签编辑。
    })
    // 挂载时重试该书签任何 failed 上传项(popup 重开即补传)。
    void pushSnapshots().catch(() => undefined)
    return () => { cancelled = true }
  }, [bookmark?.id])

  const create = async (target: LocalBookmark): Promise<boolean> => {
    if (busyAction) return false
    setBusyAction('create')
    try {
      const capture = await captureCurrentPage(tabId)
      // 本地优先:先落库(永不丢),再异步上传。不在此 notify — 由调用方决定反馈文案。
      await enqueueSnapshotUpload(target.id, capture)
      // 触发上传;成功后把服务端 DTO 合并进列表(乐观,免再请求 list)+ 同步计数。
      void pushSnapshots().then((r) => {
        if (r.uploaded.length) {
          setServerSnapshots((cur) => {
            const ids = new Set(cur.map((s) => s.id))
            return [...r.uploaded.filter((s) => !ids.has(s.id)), ...cur]
          })
          setServerTotal((n) => n + r.uploaded.length)
        }
      }).catch(() => undefined)
      return true
    } catch (error) {
      console.warn('[tmark] snapshot capture failed', error)
      return false
    } finally {
      setBusyAction(null)
    }
  }

  const openLatest = async (): Promise<void> => {
    const latest = serverSnapshots[0] ?? null
    if (!bookmark || !latest || busyAction) return
    setBusyAction('open')
    try {
      const html = await snapshotsApi.readHtml(bookmark.id, latest.id)
      // sandbox iframe 包装页承载快照 HTML,避免任意站点 HTML 在扩展 origin 渲染。
      const viewerHtml = buildSnapshotViewerHtml(bookmark.title, html)
      // R5-P3 blob URL lifetime: create the blob in the background SW via a
      // message — the popup document is destroyed when the new tab takes
      // focus, and a blob created by the popup dies with its document.
      const response = await chrome.runtime.sendMessage({ type: 'OPEN_SNAPSHOT_VIEWER', html: viewerHtml }) as { ok?: boolean; error?: string }
      if (response?.error) throw new Error(response.error)
      notify('success', t('popup.toast.snapshotOpened'))
    } catch (error) {
      console.warn('[tmark] snapshot open failed', error)
      notify('error', t('popup.toast.snapshotFail'))
    } finally {
      setBusyAction(null)
    }
  }

  return {
    enabled,
    setEnabled,
    count: serverTotal + localUploads.length,
    /** 可查看=有服务端快照可打开;count 含本地待传/失败件(创建即时反馈),
     * 其中失败/exhausted 件不可看——此前仅剩失败件时查看按钮可点但无动作。 */
    viewable: serverSnapshots.length > 0,
    create,
    openLatest,
    opening: busyAction === 'open',
  }
}
