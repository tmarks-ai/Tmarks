import { useEffect, useState } from 'react'
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
import { Input } from '@/components/ui/input'

interface InputDialogProps {
  isOpen: boolean
  title: string
  description?: string
  placeholder?: string
  initialValue?: string
  confirmText?: string
  isSubmitting?: boolean
  /** Server truncates silently past its cap; mirror it in the input. */
  maxLength?: number
  onConfirm: (value: string) => Promise<void> | void
  onCancel: () => void
}

/** 受控单行输入对话框(Radix Dialog),用于文件夹创建/重命名等。 */
export function InputDialog({
  isOpen,
  title,
  description,
  placeholder,
  initialValue = '',
  confirmText,
  isSubmitting,
  maxLength,
  onConfirm,
  onCancel,
}: InputDialogProps) {
  const { t } = useTranslation('common')
  const [value, setValue] = useState(initialValue)

  useEffect(() => {
    if (isOpen) setValue(initialValue)
  }, [isOpen, initialValue])

  const submit = () => {
    const trimmed = value.trim()
    if (trimmed) onConfirm(trimmed)
  }

  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!open) onCancel() }}>
      <DialogContent closeLabel={t('button.close')}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        <Input
          autoFocus
          placeholder={placeholder}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          maxLength={maxLength}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              submit()
            }
          }}
        />
        <DialogFooter>
          <Button variant="outline" onClick={onCancel} disabled={isSubmitting}>
            {t('button.cancel')}
          </Button>
          <Button onClick={submit} disabled={isSubmitting || !value.trim()} showPendingIndicator>
            {confirmText || t('button.confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
