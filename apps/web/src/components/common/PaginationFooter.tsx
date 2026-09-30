import type { ReactNode } from 'react'
import { ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { PAGE_SIZE_OPTIONS } from '@/lib/constants/bookmarks'

export interface PaginationFooterProps {
  currentPage: number
  currentCount: number
  hasPreviousPage: boolean
  hasNextPage: boolean
  isLoading?: boolean
  onPreviousPage: () => void
  onNextPage: () => void
  pageSize?: number
  onPageSizeChange?: (size: number) => void
}

export function PaginationFooter({
  currentPage,
  currentCount,
  hasPreviousPage,
  hasNextPage,
  isLoading = false,
  onPreviousPage,
  onNextPage,
  pageSize,
  onPageSizeChange,
}: PaginationFooterProps) {
  const { t } = useTranslation('common')
  // 第一页且无任何条目(空列表/搜索无结果)时不渲染翻页栏。
  if (currentCount === 0 && currentPage === 1) return null

  const hasPageSizeSelector = pageSize != null && onPageSizeChange != null

  return (
    <nav className="mx-auto flex w-fit items-center justify-center rounded-full py-1 pointer-events-auto">
      <div className="flex items-center gap-1.5">
        <PageButton
          label={t('pagination.prev')}
          disabled={!hasPreviousPage || isLoading}
          onClick={onPreviousPage}
          icon={<ChevronLeft className="h-4 w-4" />}
        />
        {hasPageSizeSelector ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="pagination-count-button inline-flex h-7 min-w-16 items-center justify-center gap-0.5 rounded-lg border border-border/50 px-3 text-xs font-semibold tabular-nums transition-colors hover:bg-muted/50"
              >
                {pageSize}
                <ChevronDown className="h-3 w-3 text-muted-foreground" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="center" className="min-w-20">
              {PAGE_SIZE_OPTIONS.map((size) => (
                <DropdownMenuItem
                  key={size}
                  onClick={() => onPageSizeChange(size)}
                  className={size === pageSize ? 'font-bold text-primary' : ''}
                >
                  {size}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
          <span className="pagination-count-button inline-flex h-7 min-w-16 items-center justify-center rounded-lg border border-border/50 px-3 text-xs font-semibold tabular-nums">
            {t('pagination.total', { count: currentCount })}
          </span>
        )}
        <PageButton
          label={t('pagination.next')}
          disabled={!hasNextPage || isLoading}
          onClick={onNextPage}
          icon={<ChevronRight className="h-4 w-4" />}
          iconAfter
        />
      </div>
    </nav>
  )
}

function PageButton({
  label,
  disabled,
  icon,
  iconAfter = false,
  onClick,
}: {
  label: string
  disabled: boolean
  icon: ReactNode
  iconAfter?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="pagination-footer-button inline-flex h-7 items-center gap-1 rounded-lg border border-border/50 px-2 text-xs font-semibold text-foreground backdrop-blur-sm transition-colors disabled:cursor-not-allowed disabled:opacity-45"
    >
      {!iconAfter && icon}
      <span>{label}</span>
      {iconAfter && icon}
    </button>
  )
}
