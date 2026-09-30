import type React from 'react'
import { TMarkLogo } from '@/components/brand/TMarkLogo'

export function ShellHeader({
  title,
  subtitle,
  onHome,
  right,
}: {
  title: string
  subtitle?: React.ReactNode
  onHome: () => void
  right?: React.ReactNode
}) {
  return (
    <header className="h-14 sm:h-16 sticky top-0 z-layer-sticky backdrop-blur-xl bg-card/80 border-b border-border/50 flex items-center">
      <div className="app-chrome-container flex items-center justify-between">
        <button
          onClick={onHome}
          className="flex items-center gap-2 hover:opacity-80 transition-opacity duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
        >
          <TMarkLogo className="h-[41px] sm:h-[42px] shrink-0" />
          <div className="flex flex-col gap-0.5 text-left leading-none">
            <h1 className="text-[19px] sm:text-[21px] font-bold text-primary leading-none">{title}</h1>
            {subtitle && <span className="text-[10px] sm:text-[11px] font-medium text-muted-foreground leading-none">{subtitle}</span>}
          </div>
        </button>
        {right ? <div className="flex items-center gap-4">{right}</div> : null}
      </div>
    </header>
  )
}
