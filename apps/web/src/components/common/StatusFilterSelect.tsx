import { Filter } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

interface StatusFilterOption<V extends string> {
  value: V
  label: string
  icon: LucideIcon
}

interface StatusFilterSelectProps<V extends string> {
  value: V
  allValue: V
  onValueChange: (value: V) => void
  options: StatusFilterOption<V>[]
  allLabel: string
  ariaLabel: string
}

/** 状态筛选下拉:未筛选时显示 Filter 图标+「全部」,激活时高亮并显示当前状态图标/名称。
 *  选项由调用方数组驱动,新增状态只需追加一条选项。 */
export function StatusFilterSelect<V extends string>({
  value,
  allValue,
  onValueChange,
  options,
  allLabel,
  ariaLabel,
}: StatusFilterSelectProps<V>) {
  const active = value !== allValue
  const ActiveIcon = options.find((option) => option.value === value)?.icon ?? Filter
  return (
    <Select value={value} onValueChange={(next) => onValueChange(next as V)}>
      <SelectTrigger
        className={cn(
          'h-11 w-11 flex-shrink-0 rounded-xl sm:w-auto sm:gap-2 sm:px-3',
          active && 'border-primary/40 bg-primary/10 text-primary hover:bg-primary/10',
        )}
        aria-label={ariaLabel}
      >
        <ActiveIcon className="h-4 w-4" />
        <SelectValue className="hidden sm:block" placeholder={allLabel} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={allValue}>{allLabel}</SelectItem>
        {options.map((option) => {
          const Icon = option.icon
          return (
            <SelectItem key={option.value} value={option.value}>
              <span className="inline-flex items-center gap-2">
                <Icon className="h-4 w-4 text-muted-foreground" />
                {option.label}
              </span>
            </SelectItem>
          )
        })}
      </SelectContent>
    </Select>
  )
}