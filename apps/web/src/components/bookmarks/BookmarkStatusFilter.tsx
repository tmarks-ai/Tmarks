import { Archive, CheckSquare, Pin } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { BookmarkStatusFilter as BookmarkStatusFilterValue } from '@tmarks/contracts'
import { StatusFilterSelect } from '@/components/common/StatusFilterSelect'

interface BookmarkStatusFilterProps {
  value: BookmarkStatusFilterValue
  onChange: (value: BookmarkStatusFilterValue) => void
}

/** 书签状态筛选:待办/置顶/归档(后端另支持 private,UI 暂不暴露)。 */
export function BookmarkStatusFilter({ value, onChange }: BookmarkStatusFilterProps) {
  const { t } = useTranslation('bookmarks')
  return (
    <StatusFilterSelect
      value={value}
      allValue="all"
      onValueChange={onChange}
      options={[
        { value: 'todo', label: t('filter.todo'), icon: CheckSquare },
        { value: 'pinned', label: t('filter.pinned'), icon: Pin },
        { value: 'archived', label: t('filter.archived'), icon: Archive },
      ]}
      allLabel={t('filter.all')}
      ariaLabel={t('filter.label')}
    />
  )
}