import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { tagsService } from '@/services/tags'
import type { CreateTagInput, TagQueryParams, UpdateTagInput } from '@tmarks/contracts'

const TAGS_QUERY_KEY = 'tags'

/** 标签列表;标签变化少,staleTime 1 小时。 */
export function useTags(params?: TagQueryParams, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: [TAGS_QUERY_KEY, params],
    queryFn: () => tagsService.getTags(params),
    staleTime: 60 * 60 * 1000,
    gcTime: 24 * 60 * 60 * 1000,
    // tags 列表是重查询(~8k 行读/次),不随焦点全量重取:refetchOnWindowFocus:
    // true 尊重 staleTime,书签/标签 mutation 后按 key 前缀失效才是刷新通道。
    refetchOnWindowFocus: true,
    enabled: options?.enabled ?? true,
  })
}

export function useCreateTag() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: CreateTagInput) => tagsService.createTag(data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [TAGS_QUERY_KEY] }),
  })
}

export function useUpdateTag() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateTagInput }) =>
      tagsService.updateTag(id, data),
    onSuccess: async () => {
      queryClient.invalidateQueries({ queryKey: [TAGS_QUERY_KEY] })
      await queryClient.invalidateQueries({ queryKey: ['bookmarks'] })
    },
  })
}

export function useDeleteTag() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => tagsService.deleteTag(id),
    onSuccess: async () => {
      queryClient.invalidateQueries({ queryKey: [TAGS_QUERY_KEY] })
      queryClient.invalidateQueries({ queryKey: ['bookmarks'] })
    },
  })
}
