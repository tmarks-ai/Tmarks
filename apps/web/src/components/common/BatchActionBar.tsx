import { useState } from 'react'
import type { TFunction } from 'i18next'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/common/ConfirmDialog'

export interface BatchActionBarProps {
  /** 当前命名空间绑定的翻译函数(书签/标签组各自传入)。 */
  t: TFunction
  selectedCount: number
  totalCount: number
  isPending: boolean
  canPin: boolean
  canUnpin: boolean
  canTodo: boolean
  canUntodo: boolean
  canArchive: boolean
  canUnarchive: boolean
  onSelectAll: () => void
  onClearSelection: () => void
  onPin: () => void
  onUnpin: () => void
  onTodo: () => void
  onUntodo: () => void
  onArchive: () => void
  onUnarchive: () => void
  onExport: () => void
  onDelete: () => void
  deleteTitle: string
  deleteMessage: string
  /** 语义文案在两命名空间不同时的覆盖项。 */
  totalLabel?: string
  todoLabel?: string
  untodoLabel?: string
  clearLabel?: string
  processingLabel?: string
  /** 注入到导出按钮前的领域专属操作(如书签的移动/标签下拉)。 */
  extraActions?: React.ReactNode
}

/** 批量操作栏(书签与标签组共用):选中数 + 全选 + 状态操作 + 导出/删除 + 取消选择。 */
export function BatchActionBar(props: BatchActionBarProps) {
  const { t } = props
  const [showConfirm, setShowConfirm] = useState(false)
  const hasSelection = props.selectedCount > 0

  const statusText = props.isPending
    ? (props.processingLabel ?? t('batch.pleaseSelect'))
    : hasSelection
      ? t('batch.selected', { count: props.selectedCount })
      : t('batch.pleaseSelect')

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border/70 bg-card/95 px-4 py-3 shadow-lg">
      <span className="text-sm font-medium" aria-live="polite" aria-busy={props.isPending}>
        {statusText}
      </span>
      {props.totalCount > 0 && (
        <span className="text-xs text-muted-foreground">{props.totalLabel ?? t('batch.currentView', { count: props.totalCount })}</span>
      )}

      {props.totalCount > 0 && props.selectedCount < props.totalCount && (
        <Button variant="link" size="sm" onClick={props.onSelectAll} disabled={props.isPending || props.totalCount === 0}>
          {t('batch.selectAll', { count: props.totalCount })}
        </Button>
      )}

      {props.totalCount > 0 && props.selectedCount === props.totalCount && (
        <Button variant="link" size="sm" onClick={props.onClearSelection} disabled={props.isPending}>
          {t('batch.deselectAll')}
        </Button>
      )}

      {hasSelection && (
        <div className="ml-0 flex w-full flex-wrap items-center gap-2 sm:ml-auto sm:w-auto sm:justify-end">
          {props.canPin && <Button variant="outline" size="sm" onClick={props.onPin} disabled={props.isPending}>{t('batch.pin')}</Button>}
          {props.canUnpin && <Button variant="outline" size="sm" onClick={props.onUnpin} disabled={props.isPending}>{t('batch.unpin')}</Button>}
          {props.canTodo && <Button variant="outline" size="sm" onClick={props.onTodo} disabled={props.isPending}>{props.todoLabel ?? t('batch.todo')}</Button>}
          {props.canUntodo && <Button variant="outline" size="sm" onClick={props.onUntodo} disabled={props.isPending}>{props.untodoLabel ?? t('batch.untodo')}</Button>}
          {props.canArchive && <Button variant="outline" size="sm" onClick={props.onArchive} disabled={props.isPending}>{t('batch.archive')}</Button>}
          {props.canUnarchive && <Button variant="outline" size="sm" onClick={props.onUnarchive} disabled={props.isPending}>{t('batch.unarchive')}</Button>}
          {props.extraActions}
          <Button variant="outline" size="sm" onClick={props.onExport} disabled={props.isPending}>
            {t('batch.export')}
          </Button>
          <Button variant="destructive" size="sm" onClick={() => setShowConfirm(true)} disabled={props.isPending}>
            {t('batch.delete')}
          </Button>
        </div>
      )}

      <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={props.onClearSelection} disabled={props.isPending}>
        {props.clearLabel ?? t('batch.deselectAll')}
      </Button>

      <ConfirmDialog
        isOpen={showConfirm}
        type="danger"
        title={props.deleteTitle}
        message={props.deleteMessage}
        confirmText={t('batch.delete')}
        isSubmitting={props.isPending}
        onConfirm={() => { props.onDelete(); setShowConfirm(false) }}
        onCancel={() => setShowConfirm(false)}
      />
    </div>
  )
}