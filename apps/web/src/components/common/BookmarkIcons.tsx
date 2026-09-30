import { ArrowDownUp, ArrowUpDown, Clock, LayoutGrid, List, TrendingUp } from 'lucide-react'
import type { SortOption, ViewMode } from '@/lib/constants/bookmarks'

export function SortIcon({ sort }: { sort: SortOption }) {
  if (sort === 'manual') return <ArrowUpDown className="h-5 w-5" />
  if (sort === 'updated') return <Clock className="h-5 w-5" />
  if (sort === 'popular') return <TrendingUp className="h-5 w-5" />
  return <ArrowDownUp className="h-5 w-5" />
}

export function ViewModeIcon({ mode }: { mode: ViewMode }) {
  return mode === 'minimal' ? <List className="h-5 w-5" /> : <LayoutGrid className="h-5 w-5" />
}
