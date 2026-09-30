import { useTranslation } from 'react-i18next'
import type { TagDTO } from '@tmarks/contracts'
import { Input } from '@/components/ui/input'

interface TagSelectorProps {
  tagInput: string
  setTagInput: (val: string) => void
  onTagInputKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void
  selectedTagIds: string[]
  toggleTag: (tagId: string) => void
  tags: TagDTO[]
  isPending: boolean
}

/** 标签选择器:输入框(Enter 分割即时建/选)+ 已选 chip(可删)+ 可选列表。 */
export function TagSelector({
  tagInput,
  setTagInput,
  onTagInputKeyDown,
  selectedTagIds,
  toggleTag,
  tags,
  isPending,
}: TagSelectorProps) {
  const { t } = useTranslation('bookmarks')
  const availableTags = tags.filter((tag) => !selectedTagIds.includes(tag.id))

  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between">
        <label htmlFor="tag-selector-input" className="block text-xs font-medium">
          {t('form.tags')}
          <span className="ml-1.5 text-xs text-muted-foreground">{t('form.tagsBatchHint')}</span>
        </label>
        {selectedTagIds.length > 0 && (
          <span className="text-xs text-muted-foreground">
            {t('form.tagsSelected', { count: selectedTagIds.length })}
          </span>
        )}
      </div>

      <Input
        id="tag-selector-input"
        type="text"
        className="mb-2"
        placeholder={t('form.tagsInputPlaceholder')}
        value={tagInput}
        onChange={(e) => setTagInput(e.target.value)}
        onKeyDown={onTagInputKeyDown}
        disabled={isPending}
      />

      {selectedTagIds.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1.5 rounded-md border border-primary/20 bg-primary/5 p-2">
          {selectedTagIds.map((tagId) => {
            const tag = tags.find((item) => item.id === tagId)
            if (!tag) return null
            return (
              <button
                key={tag.id}
                type="button"
                onClick={() => toggleTag(tag.id)}
                disabled={isPending}
                className="rounded-full bg-primary px-2.5 py-1 text-xs text-primary-foreground shadow-sm transition-colors hover:bg-primary/90"
              >
                {tag.name} ×
              </button>
            )
          })}
        </div>
      )}

      <div className="max-h-[120px] min-h-0 overflow-y-auto rounded-md bg-muted p-2.5">
        {tags.length === 0 ? (
          <p className="py-1 text-xs text-muted-foreground">{t('form.noTags')}</p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {availableTags.map((tag) => (
              <button
                key={tag.id}
                type="button"
                onClick={() => toggleTag(tag.id)}
                disabled={isPending}
                className="rounded-full border border-border bg-card px-2.5 py-1 text-xs text-foreground transition-colors hover:border-primary/50 hover:bg-primary/5"
              >
                {tag.name}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
