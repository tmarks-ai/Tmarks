import { useTranslation } from 'react-i18next'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'

interface ConfirmDialogProps {
  isOpen: boolean
  title: string
  message: string
  confirmText?: string
  type?: 'default' | 'danger'
  isSubmitting?: boolean
  onConfirm: () => Promise<void> | void
  onCancel: () => void
}

/** 受控确认对话框(Radix Dialog),用于删除等危险操作确认。 */
export function ConfirmDialog({
  isOpen,
  title,
  message,
  confirmText,
  type = 'default',
  isSubmitting,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const { t } = useTranslation('common')
  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!open) onCancel() }}>
      {/* 嵌套于其它对话框之上时(如快照查看器内的删除确认),提升一层避免被同层 modal 压住。 */}
      <DialogContent className="z-layer-modal-nested" closeLabel={t('button.close')}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{message}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel} disabled={isSubmitting}>
            {t('button.cancel')}
          </Button>
          <Button
            variant={type === 'danger' ? 'destructive' : 'default'}
            onClick={onConfirm}
            disabled={isSubmitting}
            showPendingIndicator
          >
            {confirmText || t('button.confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
