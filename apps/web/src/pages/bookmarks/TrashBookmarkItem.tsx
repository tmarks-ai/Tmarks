import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Calendar, Link2, RotateCcw, Trash2 } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import type { TrashBookmark } from '@tmarks/contracts'
import { dateFnsLocale } from '@/lib/locale'
import { safeImageSrc } from '@/lib/safe-url'
import { Button } from '@/components/ui/button'

interface TrashBookmarkItemProps {
  bookmark: TrashBookmark
  onRestore: (id: string, title: string) => void
  onDelete: (id: string, title: string) => void
}

/** 回收站单条:favicon + 标题 + URL + 相对删除时间 + 恢复/彻底删按钮。 */
export function TrashBookmarkItem({ bookmark, onRestore, onDelete }: TrashBookmarkItemProps) {
  const { t, i18n } = useTranslation('bookmarks')
  const dateLocale = dateFnsLocale(i18n.language)
  // 按失败的 src 记录(命令式 display:none 在 src 更换后会残留);回收站固定
  // 100 条/页,是最冷的图片突发场景,lazy 顺带压低资产路由的瞬时压力。
  const [brokenSrc, setBrokenSrc] = useState<string | null>(null)
  // safeHttpUrl 统一防线:其余全部渲染路径都过它,此处不应例外。
  const faviconSrc = safeImageSrc(bookmark.favicon)

  return (
    <div className="flex flex-col gap-4 rounded-xl border border-border/60 bg-card/95 p-4 transition-shadow hover:shadow-md sm:flex-row sm:items-center sm:justify-between sm:p-6">
      <div className="flex min-w-0 flex-1 items-start gap-3">
        {faviconSrc && faviconSrc !== brokenSrc ? (
          <img
            src={faviconSrc}
            alt=""
            className="h-6 w-6 flex-shrink-0 rounded"
            loading="lazy"
            onError={() => setBrokenSrc(faviconSrc ?? null)}
          />
        ) : (
          <Link2 className="h-6 w-6 flex-shrink-0 text-muted-foreground" />
        )}
        <div className="min-w-0 flex-1">
          <h3 className="mb-1 truncate text-lg font-semibold text-foreground">{bookmark.title}</h3>
          <p className="mb-2 truncate text-sm text-muted-foreground">{bookmark.url}</p>
          <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <Calendar className="h-4 w-4" />
            <span>
              {t('trash.deletedAt', {
                time: bookmark.deleted_at
                  ? formatDistanceToNow(new Date(bookmark.deleted_at), { addSuffix: true, locale: dateLocale })
                  : '',
              })}
            </span>
          </div>
        </div>
      </div>

      <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:flex-shrink-0">
        <Button className="flex-1 sm:flex-none" variant="outline" size="sm" onClick={() => onRestore(bookmark.id, bookmark.title)}>
          <RotateCcw className="h-4 w-4" />
          {t('trash.restore')}
        </Button>
        <Button className="flex-1 sm:flex-none" variant="destructive" size="sm" onClick={() => onDelete(bookmark.id, bookmark.title)}>
          <Trash2 className="h-4 w-4" />
          {t('trash.delete')}
        </Button>
      </div>
    </div>
  )
}
