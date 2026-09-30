import { useMemo } from 'react'
import type { BookmarkDTO, TagFilterDTO } from '@tmarks/contracts'

/**
 * 标签筛选逻辑:基于当前书签计算标签共现关系(降级方案),优先使用后端
 * 返回的 related_tag_ids(基于全量书签,更准确)。结果按 已选 → 相关 → 其他 排序。
 */
export function useTagFiltering(
  tags: TagFilterDTO[],
  bookmarks: BookmarkDTO[],
  selectedTags: string[],
  searchQuery: string,
  serverRelatedTagIds?: string[],
) {
  const coOccurrenceMap = useMemo(() => {
    const map = new Map<string, Set<string>>()
    for (const bookmark of bookmarks) {
      if (bookmark.tags.length < 2) continue
      const ids = bookmark.tags.map((tag) => tag.id)
      for (let i = 0; i < ids.length; i++) {
        const sourceId = ids[i]!
        if (!map.has(sourceId)) map.set(sourceId, new Set())
        for (let j = 0; j < ids.length; j++) {
          if (i === j) continue
          map.get(sourceId)!.add(ids[j]!)
        }
      }
    }
    return map
  }, [bookmarks])

  const relatedTagIds = useMemo(() => {
    if (selectedTags.length === 0) return new Set<string>()
    if (serverRelatedTagIds && serverRelatedTagIds.length > 0) return new Set(serverRelatedTagIds)

    if (selectedTags.length === 1) {
      const neighbors = coOccurrenceMap.get(selectedTags[0]!)
      if (!neighbors) return new Set<string>()
      return new Set([...neighbors].filter((id) => !selectedTags.includes(id)))
    }

    const firstTagNeighbors = coOccurrenceMap.get(selectedTags[0]!)
    if (!firstTagNeighbors) return new Set<string>()
    const related = new Set<string>()
    firstTagNeighbors.forEach((neighborId) => {
      if (selectedTags.includes(neighborId)) return
      const isRelatedToAll = selectedTags.every(
        (tagId) => Boolean(coOccurrenceMap.get(tagId)?.has(neighborId)),
      )
      if (isRelatedToAll) related.add(neighborId)
    })
    return related
  }, [selectedTags, coOccurrenceMap, serverRelatedTagIds])

  const filteredTags = useMemo(() => {
    if (!searchQuery.trim()) return tags
    const query = searchQuery.toLowerCase()
    return tags.filter((tag) => tag.name.toLowerCase().includes(query))
  }, [tags, searchQuery])

  const orderedTags = useMemo(() => {
    const selected: TagFilterDTO[] = []
    const related: TagFilterDTO[] = []
    const others: TagFilterDTO[] = []
    for (const tag of filteredTags) {
      if (selectedTags.includes(tag.id)) selected.push(tag)
      else if (relatedTagIds.has(tag.id)) related.push(tag)
      else others.push(tag)
    }
    return [...selected, ...related, ...others]
  }, [filteredTags, selectedTags, relatedTagIds])

  return { orderedTags, relatedTagIds }
}
