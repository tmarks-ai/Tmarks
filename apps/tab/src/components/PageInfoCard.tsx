import { useEffect, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useI18n } from '../lib/i18n'

interface Props {
  title: string
  url: string
  description?: string | null
  thumbnail?: string | null
  thumbnails?: string[]
  favicon?: string | null
  onThumbnailChange?: (index: number) => void
}

/** 页面信息卡(缩略图轮播 + 标题/URL/描述),移植自旧版 PageInfoCard。 */
function isHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}

export function PageInfoCard({ title, url, description, thumbnail, thumbnails, favicon, onThumbnailChange }: Props) {
  const { t } = useI18n()
  const imgs = (thumbnails ?? (thumbnail ? [thumbnail] : [])).filter((value): value is string => Boolean(value) && isHttpUrl(value))
  const safeFavicon = favicon && isHttpUrl(favicon) ? favicon : null
  const [idx, setIdx] = useState(0)
  // 坏图按下标记除并跳到邻图(原先整块隐藏轮播,明明还有可用图)。
  const [broken, setBroken] = useState<ReadonlySet<number>>(new Set())
  // 展示序(未坏图内)双射到原始下标:onThumbnailChange 回传原始下标,
  // 父层 handleThumbnailChange 仍按 thumbnails 原始序取图。
  const viewable = imgs.map((src, i) => ({ src, i })).filter(({ i }) => !broken.has(i))
  const pos = Math.min(idx, Math.max(0, viewable.length - 1))
  const cur = viewable[pos]?.src ?? null
  // 列表变化(重新加载页面信息)时复位坏图与序号。
  const imgsKey = imgs.join('\u0001')
  useEffect(() => { setBroken(new Set()); setIdx(0) }, [imgsKey])

  const go = (delta: number): void => {
    if (viewable.length <= 1) return
    const next = (pos + delta + viewable.length) % viewable.length
    setIdx(next)
    onThumbnailChange?.(viewable[next]!.i)
  }

  const handleError = (): void => {
    const failing = viewable[pos]?.i
    if (failing == null) return
    const nextBroken = new Set(broken).add(failing)
    setBroken(nextBroken)
    const remaining = imgs.map((src, i) => ({ src, i })).filter(({ i }) => !nextBroken.has(i))
    const nextPos = Math.min(pos, Math.max(0, remaining.length - 1))
    setIdx(nextPos)
    // 展示图变了,封面选择也要跟上,避免"显示 A、保存 B"。
    const nextRaw = remaining[nextPos]?.i
    if (nextRaw != null && nextRaw !== failing) onThumbnailChange?.(nextRaw)
  }

  return (
    <div className="overflow-hidden rounded-xl border border-[var(--tab-border)] bg-[var(--tab-surface)] shadow-sm">
      {cur && (
        <div className="group relative h-28 bg-[var(--tab-surface-muted)]">
          <img
            src={cur}
            alt=""
            className="h-full w-full object-cover"
            onError={handleError}
          />
          {viewable.length > 1 && (
            <>
              <button type="button" onClick={() => go(-1)} className="absolute left-1 top-1/2 -translate-y-1/2 rounded-full bg-[var(--tab-overlay)] p-1 text-white opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100" aria-label={t('carousel.prev')}><ChevronLeft className="h-4 w-4" /></button>
              <button type="button" onClick={() => go(1)} className="absolute right-1 top-1/2 -translate-y-1/2 rounded-full bg-[var(--tab-overlay)] p-1 text-white opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100" aria-label={t('carousel.next')}><ChevronRight className="h-4 w-4" /></button>
              <span className="absolute bottom-1 right-1 rounded bg-[var(--tab-overlay)] px-1.5 py-0.5 text-[10px] text-white">{pos + 1} / {viewable.length}</span>
            </>
          )}
        </div>
      )}
      <div className="space-y-2 p-3">
        <div className="flex items-center gap-2">
          {safeFavicon && <img src={safeFavicon} alt="" className="h-4 w-4 shrink-0 rounded" onError={(e) => { (e.currentTarget as HTMLImageElement).style.visibility = 'hidden' }} />}
          <p className="line-clamp-2 text-sm font-semibold text-[var(--tab-text)]">{title}</p>
        </div>
        <p className="truncate text-xs text-[var(--tab-text-muted)]">{url}</p>
        {description && <p className="line-clamp-3 text-xs text-[var(--tab-text-muted)]">{description}</p>}
      </div>
    </div>
  )
}
