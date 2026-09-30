import { cn } from '../lib/utils/cn'
import { Loader2 } from 'lucide-react'

/** 居中旋转圈(用于内联加载态,如 TabCollectionView 加载标签页)。 */
export function LoadingSpinner({ className = '' }: { className?: string }) {
  return <Loader2 className={cn(`h-5 w-5 animate-spin text-[var(--tab-message-info-icon)] ${className}`)} />
}
