import { useState } from 'react'
import { cn } from '@/lib/utils'
import { useTranslation } from 'react-i18next'
import type { TabGroupDTO } from '@tmarks/contracts'
import { useToastStore } from '@/stores/toastStore'
import { useExtensionAvailable } from '@/hooks/useExtensionBridge'
import type { WindowMode } from '@/lib/extension-bridge'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { openTabGroupItems } from './openTabGroupItems'

const WINDOW_MODES: WindowMode[] = ['new', 'current', 'incognito']

const MODE_LABEL_KEY: Record<WindowMode, string> = {
  new: 'menu.openInNewWindow',
  current: 'menu.openInCurrentWindow',
  incognito: 'menu.openInIncognito',
}

interface OpenAllTabsDialogProps {
  group: TabGroupDTO | null
  onClose: () => void
}

/**
 * 全部打开确认框:扩展可用时展示打开方式分段选择器(新窗口/当前窗口/隐身),经桥接中继;
 * 否则隐藏选择器、隐式新窗口并降级 window.open。
 */
export function OpenAllTabsDialog({ group, onClose }: OpenAllTabsDialogProps) {
  const { t } = useTranslation('tabGroups')
  const { t: tc } = useTranslation('common')
  const toast = useToastStore.getState()
  const extensionAvailable = useExtensionAvailable()
  const [windowMode, setWindowMode] = useState<WindowMode>('new')
  const [opening, setOpening] = useState(false)

  const count = group?.items?.length ?? 0
  const showModeSelector = extensionAvailable === true && count > 0

  const handleConfirm = async () => {
    if (!group || opening) return
    setOpening(true)
    try {
      const result = await openTabGroupItems(group.items || [], windowMode)
      if (result.opened === 0) toast.error(t('message.cannotOpenWindow'))
      else if (result.opened < result.total) toast.warning(t('message.openedTabsPartial', result))
      else toast.success(t('message.openedTabs', { count: result.opened }))
      onClose()
    } finally {
      setOpening(false)
    }
  }

  return (
    <Dialog open={Boolean(group)} onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent className="max-w-md" closeLabel={tc('button.close')}>
        <DialogHeader>
          <DialogTitle>{t('confirm.openMultipleTabs')}</DialogTitle>
          <DialogDescription className="whitespace-pre-line">
            {t('confirm.openTabsWarning', { count })}
          </DialogDescription>
        </DialogHeader>

        {showModeSelector && (
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">{t('confirm.windowMode')}</label>
            <div className="grid grid-cols-3 gap-1.5">
              {WINDOW_MODES.map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setWindowMode(mode)}
                  className={cn(`rounded-lg border px-2 py-1.5 text-xs font-medium transition-colors ${
                    windowMode === mode
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-border text-muted-foreground hover:bg-muted/50'
                  }`)}
                >
                  {t(MODE_LABEL_KEY[mode])}
                </button>
              ))}
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{tc('button.cancel')}</Button>
          <Button onClick={handleConfirm} disabled={count === 0 || opening} showPendingIndicator>{t('action.openAll')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
