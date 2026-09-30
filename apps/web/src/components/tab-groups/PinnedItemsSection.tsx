import { ExternalLink, Folder, Pin } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { TabGroupDTO, TabGroupItemDTO } from '@tmarks/contracts'
import { Hint } from '@/components/ui/tooltip'
import { safeHttpUrl, safeImageSrc } from '@/lib/safe-url'

interface PinnedItem extends TabGroupItemDTO {
  groupTitle: string
  groupId: string
}

interface PinnedItemsSectionProps {
  tabGroups: TabGroupDTO[]
  onUnpin?: (item: TabGroupItemDTO) => void
  i18nNs?: string
}

/** 置顶区:扁平化所有组的 is_pinned 条目,网格卡片展示(标题 + 所属组 + 取消固定),无置顶返回 null。 */
export function PinnedItemsSection({ tabGroups, onUnpin, i18nNs = 'tabGroups' }: PinnedItemsSectionProps) {
  const { t } = useTranslation(i18nNs)
  const pinnedItems: PinnedItem[] = []
  tabGroups.forEach((group) => {
    (group.items || []).forEach((item) => {
      if (item.is_pinned) {
        pinnedItems.push({ ...item, groupTitle: group.title, groupId: group.id })
      }
    })
  })
  if (pinnedItems.length === 0) return null

  return (
    <section className="mb-6">
      <header className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
        <Pin className="h-4 w-4 text-amber-500" />
        <span>{t('item.pinned')}</span>
        <span className="text-xs font-normal text-muted-foreground">{pinnedItems.length}</span>
      </header>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {pinnedItems.map((item) => (
          <PinnedItemCard key={item.id} item={item} onUnpin={onUnpin} i18nNs={i18nNs} />
        ))}
      </div>
    </section>
  )
}

/** 单个置顶项卡片:favicon/标题/所属组;URL 协议非法时降级纯文本(不可点)。 */
function PinnedItemCard({ item, onUnpin, i18nNs }: { item: PinnedItem; onUnpin?: (item: TabGroupItemDTO) => void; i18nNs: string }) {
  const { t } = useTranslation(i18nNs)
  const href = safeHttpUrl(item.url)
  // 与书签列表一致:safeImageSrc 只放行 http(s) 与 /api/ 资产路径,阻止
  // favicon 字段携带的 javascript:/data: 等 src 注入。
  const faviconSrc = safeImageSrc(item.favicon)
  return (
    <article className="group relative flex items-center gap-2 rounded-xl border border-border/60 bg-card p-3">
      {onUnpin && (
        <Hint label={t('menu.unpin')}>
          <button
            type="button"
            onClick={(event) => { event.preventDefault(); event.stopPropagation(); onUnpin(item) }}
            className="absolute right-1.5 top-1.5 flex h-7 w-7 items-center justify-center rounded-lg text-amber-500 opacity-100 hover:bg-muted sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100"
            aria-label={t('menu.unpin')}
          >
            <Pin className="h-3.5 w-3.5" />
          </button>
        </Hint>
      )}
      <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center">
        {faviconSrc ? (
          <img
            src={faviconSrc}
            alt=""
            className="h-5 w-5 rounded"
            onError={(event) => { event.currentTarget.style.display = 'none' }}
          />
        ) : (
          <ExternalLink className="h-4 w-4 text-muted-foreground" />
        )}
      </span>
      {href ? (
        <a href={href} target="_blank" rel="noopener noreferrer" className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-foreground hover:text-primary">{item.title}</p>
          <p className="flex items-center gap-1 truncate text-xs text-muted-foreground">
            <Folder className="h-3 w-3" />
            {item.groupTitle}
          </p>
        </a>
      ) : (
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-foreground">{item.title}</p>
          <p className="flex items-center gap-1 truncate text-xs text-muted-foreground">
            <Folder className="h-3 w-3" />
            {item.groupTitle}
          </p>
        </div>
      )}
    </article>
  )
}
