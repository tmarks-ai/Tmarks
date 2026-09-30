import { useI18n } from '../lib/i18n'
import { type TagTheme, getSuggestedTagClass } from '../lib/utils/tagStyles'

export interface TagItem {
  name: string
  isNew?: boolean
  color?: string | null
}

interface Props {
  tags: TagItem[]
  selectedNames: string[]
  onToggle: (name: string) => void
  theme?: TagTheme
}

/** 标签芯片列表(AI 推荐 / 标签库通用),按 TagTheme 着色,移植自旧版 TagList。 */
export function TagList({ tags, selectedNames, onToggle, theme = 'classic' }: Props) {
  const { t } = useI18n()
  return (
    <div className="flex flex-wrap gap-1.5">
      {tags.map((tag) => {
        // 与 toggleTag/addCustomTag/保存解析同口径:选中态大小写不敏感,
        // 否则库芯片"llm"显示未选中,点它反而移除用户手输的"LLM"。
        const selected = selectedNames.some((name) => name.toLowerCase() === tag.name.toLowerCase())
        return (
          <button key={tag.name} type="button" onClick={() => onToggle(tag.name)} className={getSuggestedTagClass(theme, selected, Boolean(tag.isNew))}>
            <span className="max-w-[110px] truncate">{tag.name}</span>
            {tag.isNew && <span className="ml-1 text-[10px] italic uppercase tracking-widest text-[var(--tab-tag-new-indicator)]">{t('tag.new')}</span>}
          </button>
        )
      })}
    </div>
  )
}
