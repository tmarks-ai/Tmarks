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
import { safeHttpUrl } from '@/lib/safe-url'

interface TabGroupItemFormModalProps {
  isOpen: boolean
  title: string
  description?: string
  initialTitle?: string
  initialUrl?: string
  confirmText?: string
  isSubmitting?: boolean
  onConfirm: (data: { title: string; url: string }) => Promise<void> | void
  onCancel: () => void
}

/** 标签页条目添加对话框(Radix Dialog,标题 + URL 双字段)。 */
export function TabGroupItemFormModal({
  isOpen,
  title,
  description,
  initialTitle = '',
  initialUrl = '',
  confirmText,
  isSubmitting,
  onConfirm,
  onCancel,
}: TabGroupItemFormModalProps) {
  const { t } = useTranslation('tabGroups')
  const { t: tc } = useTranslation('common')
  const [itemTitle, setItemTitle] = useState(initialTitle)
  const [itemUrl, setItemUrl] = useState(initialUrl)
  const [urlError, setUrlError] = useState<string | null>(null)

  useEffect(() => {
    if (isOpen) {
      setItemTitle(initialTitle)
      setItemUrl(initialUrl)
      setUrlError(null)
    }
  }, [isOpen, initialTitle, initialUrl])

  const submit = () => {
    const trimmedTitle = itemTitle.trim()
    const trimmedUrl = itemUrl.trim()
    // 入口校验:条目 URL 之后会被 window.open/扩展打开,只接受 http(s)。
    // 库里已存在的历史脏数据由 openTabGroupItems 的 safeHttpUrl 过滤兜底。
    if (!safeHttpUrl(trimmedUrl)) {
      setUrlError(t('item.urlInvalid'))
      return
    }
    setUrlError(null)
    if (trimmedTitle && trimmedUrl) onConfirm({ title: trimmedTitle, url: trimmedUrl })
  }

  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!open) onCancel() }}>
      <DialogContent closeLabel={tc('button.close')}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        <div className="space-y-3">
          <Input
            autoFocus
            placeholder={t('item.titlePlaceholder')}
            value={itemTitle}
            onChange={(event) => setItemTitle(event.target.value)}
            maxLength={500}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                document.getElementById('tab-item-url-input')?.focus()
              }
            }}
          />
          <Input
            id="tab-item-url-input"
            placeholder={t('item.urlPlaceholder')}
            value={itemUrl}
            onChange={(event) => setItemUrl(event.target.value)}
            maxLength={2000}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                submit()
              }
            }}
            aria-invalid={Boolean(urlError)}
          />
          {urlError && <p className="text-sm text-destructive">{urlError}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel} disabled={isSubmitting}>
            {tc('button.cancel')}
          </Button>
          <Button
            onClick={submit}
            disabled={isSubmitting || !itemTitle.trim() || !itemUrl.trim()}
            showPendingIndicator
          >
            {confirmText || tc('button.confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
