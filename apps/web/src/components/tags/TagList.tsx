import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import type { TagFilterDTO } from '@tmarks/contracts'
import { TagItem } from './TagItem'

interface TagListProps {
  tags: TagFilterDTO[]
  selectedIds: string[]
  relatedIds: Set<string>
  /** (tagId) => void:直接下传保持引用稳定,配合 memo 化的 TagItem 跳过键击重渲染。 */
  onToggle: (tagId: string) => void
  /** 标签排列(外观设置):grid=按行平铺;masonry=按列填充。 */
  layout?: 'grid' | 'masonry'
}

/** 标签列表:无选中时平铺;有选中时分 已选/相关/全部 三段。单列布局。 */
export function TagList({ tags, selectedIds, relatedIds, onToggle, layout = 'grid' }: TagListProps) {
  const { t } = useTranslation('tags')
  const hasSelection = selectedIds.length > 0
  const sections = useMemo(() => {
    if (!hasSelection) return null
    const selectedSet = new Set(selectedIds)
    const selected = tags.filter((tag) => selectedSet.has(tag.id))
    const related = tags.filter((tag) => !selectedSet.has(tag.id) && relatedIds.has(tag.id))
    const others = tags.filter((tag) => !selectedSet.has(tag.id) && !relatedIds.has(tag.id))
    return { selected, related, others }
  }, [tags, selectedIds, relatedIds, hasSelection])

  if (!sections) {
    return <TagGrid tags={tags} selectedIds={selectedIds} relatedIds={relatedIds} onToggle={onToggle} layout={layout} />
  }

  return (
    <div className="space-y-4">
      <TagSection title={t('section.selected')} tags={sections.selected} selectedIds={selectedIds} relatedIds={relatedIds} onToggle={onToggle} layout={layout} />
      <TagSection title={t('section.related')} tags={sections.related} selectedIds={selectedIds} relatedIds={relatedIds} onToggle={onToggle} layout={layout} />
      <TagSection title={t('section.all')} tags={sections.others} selectedIds={selectedIds} relatedIds={relatedIds} onToggle={onToggle} layout={layout} />
    </div>
  )
}

function TagSection({
  title,
  tags,
  selectedIds,
  relatedIds,
  onToggle,
  layout = 'grid',
}: TagListProps & { title: string }) {
  if (tags.length === 0) return null
  return (
    <section className="space-y-2">
      <div className="px-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground/70">
        {title}
      </div>
      <TagGrid tags={tags} selectedIds={selectedIds} relatedIds={relatedIds} onToggle={onToggle} layout={layout} />
    </section>
  )
}

function TagGrid({ tags, selectedIds, relatedIds, onToggle, layout = 'grid' }: TagListProps) {
  const hasSelection = selectedIds.length > 0
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds])
  // grid:按行平铺(默认);masonry:CSS 多列按列填充,窄栏下更省纵向空间。
  return (
    <div className={layout === 'masonry'
      ? 'columns-2 gap-1.5 xl:columns-3 [&>*]:mb-1.5 [&>*]:break-inside-avoid'
      : 'flex flex-wrap gap-1.5'}>
      {tags.map((tag) => (
        <TagItem
          key={tag.id}
          tag={tag}
          isSelected={selectedSet.has(tag.id)}
          isRelated={relatedIds.has(tag.id)}
          hasSelection={hasSelection}
          onToggle={onToggle}
        />
      ))}
    </div>
  )
}
