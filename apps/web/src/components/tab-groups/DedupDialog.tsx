import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { TabGroupDTO, TabGroupDedupResult } from '@tmarks/contracts'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { tabGroupsService } from '@/services/tab-groups'
import { useDedupTabGroup } from '@/hooks/useTabGroups'
import { useToastStore } from '@/stores/toastStore'

interface DedupDialogProps {
  isOpen: boolean
  group: TabGroupDTO
  onCancel: () => void
}

type Phase = 'scanning' | 'preview' | 'deleting'

/** 组内 URL 去重对话框:打开即 dry_run 预览重复项;无重复提示关闭,有重复列表明细 + 确认执行删除。 */
export function DedupDialog({ isOpen, group, onCancel }: DedupDialogProps) {
  const { t } = useTranslation('tabGroups')
  const { t: tc } = useTranslation('common')
  const toast = useToastStore.getState()
  const dedup = useDedupTabGroup()
  const [phase, setPhase] = useState<Phase>('scanning')
  const [result, setResult] = useState<TabGroupDedupResult | null>(null)

  // 依赖只收真正决定扫描的输入(isOpen/group.id):onCancel 是父组件每次渲染
  // 的新闭包、toast 是 store 快照,收进依赖会让父层任何重渲染(窗口焦点重取
  // 等)都重置阶段并重发 dry_run——对话框闪回扫描态、重复请求。
  const stableRefs = useRef({ onCancel, toast, t })
  stableRefs.current = { onCancel, toast, t }
  useEffect(() => {
    if (!isOpen) return
    setPhase('scanning')
    setResult(null)
    let cancelled = false
    tabGroupsService
      .dedupTabGroup(group.id, { dry_run: true })
      .then((res) => {
        if (!cancelled) {
          setResult(res)
          setPhase('preview')
        }
      })
      .catch(() => {
        if (!cancelled) {
          stableRefs.current.toast.error(stableRefs.current.t('message.dedupFailed'))
          stableRefs.current.onCancel()
        }
      })
    return () => {
      cancelled = true
    }
  }, [isOpen, group.id])

  const handleConfirm = () => {
    setPhase('deleting')
    dedup.mutate(
      { groupId: group.id, data: { dry_run: false } },
      {
        onSuccess: (res) => {
          toast.success(t('message.duplicatesRemoved', { count: res.removed }))
          onCancel()
        },
        onError: () => {
          toast.error(t('message.dedupFailed'))
          onCancel()
        },
      },
    )
  }

  const totalToRemove = result?.duplicates.flatMap((d) => d.removed_ids).length ?? 0
  const busy = phase === 'scanning' || phase === 'deleting'
  const hasDuplicates = !!result && result.duplicates.length > 0

  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!open) onCancel() }}>
      <DialogContent closeLabel={tc('button.close')} className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('confirm.removeDuplicates')}</DialogTitle>
          <DialogDescription className="sr-only">{t('confirm.removeDuplicates')}</DialogDescription>
        </DialogHeader>

        {busy ? (
          <p className="py-6 text-center text-sm text-muted-foreground">{t('dedup.scanning')}</p>
        ) : !hasDuplicates ? (
          <p className="py-6 text-center text-sm text-muted-foreground">{t('message.noDuplicates')}</p>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">{t('dedup.willRemove', { count: totalToRemove })}</p>
            <ul className="tmarks-scrollbar max-h-60 space-y-1.5 overflow-y-auto pr-1">
              {result!.duplicates.map((d) => (
                <li key={d.kept_id} className="rounded-lg border border-border/60 bg-muted/30 px-3 py-2">
                  <p className="truncate text-xs font-medium text-foreground" title={d.url}>{d.url}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {t('dedup.duplicateCount', { count: d.removed_ids.length })}
                  </p>
                </li>
              ))}
            </ul>
          </div>
        )}

        <DialogFooter>
          {busy ? (
            <Button variant="outline" onClick={onCancel} disabled={phase === 'deleting'}>
              {tc('button.close')}
            </Button>
          ) : !hasDuplicates ? (
            <Button variant="outline" onClick={onCancel}>{tc('button.close')}</Button>
          ) : (
            <>
              <Button variant="outline" onClick={onCancel} disabled={dedup.isPending}>{t('action.cancel')}</Button>
              <Button variant="destructive" onClick={handleConfirm} disabled={dedup.isPending}>
                {t('confirm.removeDuplicates')}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
