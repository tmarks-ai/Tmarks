import { useCallback, useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { ArrowDownUp, Plus, Search, Settings } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { BookmarkDTO, TagFilterDTO, TagQueryParams } from '@tmarks/contracts'
import { useCreateTag, useTags } from '@/hooks/useTags'
import { tagsService } from '@/services/tags'
import { logger } from '@/lib/logger'
import { describeMutationError } from '@/lib/describe-error'
import { useToastStore } from '@/stores/toastStore'
import { Input } from '@/components/ui/input'
import { TagList } from './TagList'
import { useTagFiltering } from './useTagFiltering'
import { TagManageModal } from './TagManageModal'
import { TagFormModal } from './TagFormModal'

type TagSortBy = NonNullable<TagQueryParams['sort']>

interface TagSidebarProps {
  selectedTags: string[]
  onTagsChange: (tags: string[]) => void
  bookmarks: BookmarkDTO[]
  searchQuery?: string
  relatedTagIds?: string[]
  readOnly?: boolean
  providedTags?: TagFilterDTO[]
  /** 标签排列(外观设置):grid=按行平铺;masonry=按列填充。 */
  layout?: 'grid' | 'masonry'
}

/** 标签侧栏:排序切换 + 创建表单 + 管理入口 + 标签列表(已选/相关/其他排序)。 */
export function TagSidebar({
  selectedTags,
  onTagsChange,
  bookmarks,
  searchQuery = '',
  relatedTagIds: serverRelatedTagIds,
  readOnly = false,
  providedTags,
  layout = 'grid',
}: TagSidebarProps) {
  const { t } = useTranslation('tags')
  const { t: tc } = useTranslation('common')
  const toast = useToastStore.getState()
  const queryClient = useQueryClient()
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [showManageModal, setShowManageModal] = useState(false)
  const [sortBy, setSortBy] = useState<TagSortBy>('usage')
  const [tagSearch, setTagSearch] = useState('')

  const tagQuery = useTags({ sort: sortBy }, { enabled: !readOnly && !providedTags })
  const createTag = useCreateTag()
  const privateTags = useMemo(() => tagQuery.data?.tags ?? [], [tagQuery.data?.tags])
  const tags = useMemo(() => {
    const source = providedTags ?? privateTags
    if (!providedTags || sortBy === 'usage') return source
    return [...source].sort((a, b) => sortBy === 'name'
      ? a.name.localeCompare(b.name)
      : b.bookmark_count - a.bookmark_count)
  }, [privateTags, providedTags, sortBy])
  const isLoading = providedTags ? false : tagQuery.isLoading
  const isError = providedTags ? false : tagQuery.isError

  const { orderedTags, relatedTagIds } = useTagFiltering(
    tags,
    bookmarks,
    selectedTags,
    tagSearch || searchQuery,
    serverRelatedTagIds,
  )

  // useCallback:引用跨渲染稳定(搜索键击不触发重建),配合 memo 化的 TagItem,
  // 侧栏搜索时整列标签行跳过重渲染。tagSearch 不是依赖——本函数不读它。
  const handleToggleTag = useCallback((tagId: string) => {
    if (selectedTags.includes(tagId)) {
      onTagsChange(selectedTags.filter((id) => id !== tagId))
    } else {
      onTagsChange([...selectedTags, tagId])
      if (readOnly) return
      void tagsService.incrementClick(tagId).then(() => {
        // 原地递增所有 ['tags'] 缓存里的 click_count:点击是高频动作,整表
        // refetch(staleTime 1h)既慢也不必要;原地更新让 sort=clicks 排序与
        // 计数立即反映本次点击,下次正常失效仍会拿到服务端真值。
        queryClient.setQueriesData<{ tags: Array<{ id: string; click_count: number }> }>({ queryKey: ['tags'] }, (data) =>
          data ? { ...data, tags: data.tags.map((tag) => (tag.id === tagId ? { ...tag, click_count: tag.click_count + 1 } : tag)) } : data)
      }).catch((error) => {
        logger.error('Failed to increment tag click count:', error)
      })
    }
  }, [selectedTags, onTagsChange, readOnly, queryClient])

  const handleCreateTag = async (name: string, color: string | null) => {
    if (!name.trim()) return
    try {
      await createTag.mutateAsync({ name: name.trim(), color: color ?? undefined })
      setShowCreateModal(false)
      toast.success(t('message.createSuccess'))
    } catch (error) {
      logger.error('Failed to create tag:', error)
      // 撞活名(409 TAG_EXISTS)的具体服务端信息优于泛化"创建失败"。
      toast.error(describeMutationError(error, tc))
    }
  }

  const cycleSort = () => {
    setSortBy((current) => (current === 'usage' ? 'clicks' : current === 'clicks' ? 'name' : 'usage'))
  }

  const sortTitle =
    sortBy === 'usage' ? t('sort.byUsage') : sortBy === 'clicks' ? t('sort.byClicks') : t('sort.byName')

  return (
    <>
      <div className="flex h-full min-h-0 flex-col rounded-2xl border border-border/70 bg-card/90 p-4 shadow-sm">
        <div className="mb-4 flex flex-shrink-0 items-center gap-2">
          <h3 className="flex-shrink-0 text-base font-bold text-primary">{t('title')}</h3>
          <button
            type="button"
            onClick={cycleSort}
            className="rounded-md p-2 text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label={sortTitle}
          >
            <ArrowDownUp className="h-4 w-4" />
          </button>
          {!readOnly && (
            <>
              <button
                type="button"
                onClick={() => setShowManageModal(true)}
                className="ml-auto rounded-md p-2 text-muted-foreground hover:bg-muted hover:text-foreground"
                aria-label={t('action.manage')}
              >
                <Settings className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => setShowCreateModal(true)}
                className="rounded-md p-2 text-muted-foreground hover:bg-muted hover:text-foreground"
                aria-label={t('action.create')}
              >
                <Plus className="h-4 w-4" />
              </button>
            </>
          )}
        </div>

        <div className="mb-3 flex-shrink-0">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="text"
              value={tagSearch}
              onChange={(e) => setTagSearch(e.target.value)}
              aria-label={t('filter.searchPlaceholder')}
              placeholder={t('filter.searchPlaceholder')}
              className="h-8 pl-8 pr-2 text-xs"
            />
          </div>
        </div>

        <div className="scrollbar-hide min-h-0 flex-1 overflow-y-auto p-1 overscroll-contain">
          {isError ? (
            <div className="py-8 text-center">
              <p className="mb-2 text-sm text-destructive">{t('status.loadFailed')}</p>
              <button type="button" onClick={() => void tagQuery.refetch()} className="text-xs font-medium text-primary hover:underline">
                {t('status.retry')}
              </button>
            </div>
          ) : isLoading ? (
            <div className="py-8 text-center text-sm text-muted-foreground/60">{t('status.loading')}</div>
          ) : orderedTags.length === 0 && (
            <div className="py-12 text-center text-muted-foreground/60">
              <p className="text-sm">{(tagSearch || searchQuery) ? t('empty.noMatch') : t('empty.description')}</p>
            </div>
          )}
          {!isError && !isLoading && orderedTags.length > 0 && (
            <TagList
              tags={orderedTags}
              selectedIds={selectedTags}
              relatedIds={relatedTagIds}
              onToggle={handleToggleTag}
              layout={layout}
            />
          )}
        </div>
      </div>

      {!readOnly && showManageModal && <TagManageModal tags={privateTags} onClose={() => setShowManageModal(false)} />}
      {!readOnly && (
        <TagFormModal
          isOpen={showCreateModal}
          title={t('action.create')}
          initialName=""
          initialColor={null}
          onConfirm={handleCreateTag}
          onCancel={() => setShowCreateModal(false)}
          isSubmitting={createTag.isPending}
        />
      )}
    </>
  )
}
