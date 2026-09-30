import { FilterX, FolderOpen, SearchX } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { EmptyState as CommonEmptyState } from '@/components/common/EmptyState'

interface EmptyStateProps {
  isSearching: boolean
  searchQuery?: string
  isFiltering?: boolean
  onClearFilter?: () => void
  onCreateGroup?: () => void
  createLabel?: string
  i18nNs?: string
}

/** 标签页收纳空态(基于 common/EmptyState 的命名空间适配层):搜索无果/筛选无果/无组。 */
export function EmptyState({
  isSearching,
  searchQuery,
  isFiltering,
  onClearFilter,
  onCreateGroup,
  createLabel,
  i18nNs = 'tabGroups',
}: EmptyStateProps) {
  const { t } = useTranslation(i18nNs)
  if (isSearching) {
    return (
      <CommonEmptyState
        icon={SearchX}
        title={t('search.noResults')}
        description={t('search.tryDifferent', { query: searchQuery || '' })}
      />
    )
  }
  if (isFiltering) {
    return (
      <CommonEmptyState
        icon={FilterX}
        title={t('filter.noResults')}
        action={
          onClearFilter ? (
            <Button variant="outline" size="sm" onClick={onClearFilter}>
              {t('filter.clear')}
            </Button>
          ) : undefined
        }
      />
    )
  }
  return (
    <CommonEmptyState
      icon={FolderOpen}
      title={t('empty.title')}
      description={t('empty.description')}
      action={
        onCreateGroup ? (
          <Button onClick={onCreateGroup}>{createLabel || t('action.create')}</Button>
        ) : undefined
      }
    />
  )
}