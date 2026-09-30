import { useEffect, useState } from 'react'
import { cn } from '@/lib/utils'
import { useTranslation } from 'react-i18next'
import { X } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { TAB_GROUP_COLORS } from '@/lib/constants/tab-groups'

interface TagFormModalProps {
  isOpen: boolean
  title: string
  initialName: string
  initialColor?: string | null
  onConfirm: (name: string, color: string | null) => void
  onCancel: () => void
  confirmLabel?: string
  isSubmitting?: boolean
  onDelete?: () => void
  isDeleting?: boolean
  errorText?: string
}

/** 标签编辑表单(Radix Dialog 受控):名称 + 颜色色板 + 删除/取消/保存。 */
export function TagFormModal({
  isOpen,
  title,
  initialName,
  initialColor = null,
  onConfirm,
  onCancel,
  confirmLabel,
  isSubmitting = false,
  onDelete,
  isDeleting = false,
  errorText,
}: TagFormModalProps) {
  const { t } = useTranslation('tags')
  const { t: tc } = useTranslation('common')
  const [name, setName] = useState(initialName)
  const [color, setColor] = useState<string | null>(initialColor)

  useEffect(() => {
    if (isOpen) {
      setName(initialName)
      setColor(initialColor ?? null)
    }
  }, [isOpen, initialName, initialColor])

  const dirty = name.trim() !== initialName.trim() || color !== (initialColor ?? null)

  const submit = () => {
    if (!name.trim() || isSubmitting) return
    onConfirm(name.trim(), color)
  }

  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!open) onCancel() }}>
      <DialogContent className="max-w-sm" closeLabel={tc('button.close')}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{t('form.editHint')}</DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">{t('form.nameLabel')}</label>
            <Input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={t('form.namePlaceholder')}
              maxLength={50}
              autoFocus
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !isSubmitting && name.trim()) submit()
              }}
            />
            {errorText && <p className="text-xs text-destructive">{errorText}</p>}
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">{t('form.colorLabel')}</label>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setColor(null)}
                className={cn(`flex h-7 w-7 items-center justify-center rounded-full border-2 ${color === null ? 'border-primary' : 'border-border'}`)}
                title={t('form.noColor')}
                aria-label={t('form.noColor')}
              >
                <X className="h-4 w-4 text-muted-foreground" />
              </button>
              {TAB_GROUP_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setColor(c)}
                  className={cn(`h-7 w-7 rounded-full border-2 ${color === c ? 'border-primary ring-2 ring-primary/30' : 'border-transparent'}`)}
                  style={{ backgroundColor: c }}
                  aria-label={c}
                />
              ))}
            </div>
          </div>
        </div>

        <DialogFooter className="sm:justify-between">
          {onDelete ? (
            <Button
              type="button"
              variant="destructive"
              onClick={onDelete}
              disabled={isSubmitting || isDeleting}
              showPendingIndicator={isDeleting}
            >
              {isDeleting ? t('action.deleting') : t('action.delete')}
            </Button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={onCancel} disabled={isSubmitting || isDeleting}>
              {tc('button.cancel')}
            </Button>
            <Button
              type="button"
              onClick={submit}
              disabled={!name.trim() || isSubmitting || isDeleting || !dirty}
              showPendingIndicator={isSubmitting}
            >
              {isSubmitting ? t('action.saving') : (confirmLabel ?? t('action.save'))}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
