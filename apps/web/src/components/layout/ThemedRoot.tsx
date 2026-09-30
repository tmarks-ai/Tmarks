import type React from 'react'
import { cn } from '@/lib/utils'
import { useThemeStore } from '@/stores/themeStore'
import { useDocumentTheme } from '@/shared/ui-theme'
import { TooltipProvider } from '@/components/ui/tooltip'

export function ThemedRoot({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  const preference = useThemeStore((s) => s.preference)
  useDocumentTheme(preference)
  return (
    <TooltipProvider delayDuration={300}>
      <div className={cn(`min-h-screen ${className}`.trim())}>{children}</div>
    </TooltipProvider>
  )
}
