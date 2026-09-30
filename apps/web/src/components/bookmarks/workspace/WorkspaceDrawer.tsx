import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'

interface WorkspaceDrawerProps {
  isOpen: boolean
  title: string
  side?: 'left' | 'right'
  onClose: () => void
  children: ReactNode
}

/** Radix Sheet 实现的工作区抽屉(移动端 panel)。 */
export function WorkspaceDrawer({
  isOpen,
  title,
  side = 'left',
  onClose,
  children,
}: WorkspaceDrawerProps) {
  const { t } = useTranslation('common')
  return (
    <Sheet open={isOpen} onOpenChange={(open) => { if (!open) onClose() }}>
      <SheetContent side={side} closeLabel={t('button.close')}>
        <SheetHeader>
          <SheetTitle>{title}</SheetTitle>
          {/* Radix wires this to aria-describedby; without it a screen reader
              announces the drawer with nothing beyond its title. */}
          <SheetDescription className="sr-only">{t('a11y.drawerDescription')}</SheetDescription>
        </SheetHeader>
        <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
      </SheetContent>
    </Sheet>
  )
}
