import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type InfiniteData,
} from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { describeMutationError } from '@/lib/describe-error'
import { bookmarksService } from '@/services/bookmarks'
import { useToastStore } from '@/stores/toastStore'
import type {
  BookmarkDTO,
  BookmarkQueryParams,
  BookmarksResponse,
  CreateBookmarkInput,
  ReorderBookmarkItem,
  ReorderBookmarksInput,
  ReorderPinnedInput,
  UpdateBookmarkInput,
} from '@tmarks/contracts'

const BOOKMARKS_QUERY_KEY = 'bookmarks'
const FOLDERS_KEY = ['bookmark-folders'] as const

/** 书签 mutation 后用 reset 而非 invalidate:invalidate 按各页首载的 pageParams
 * 重取缓存页,行集变化后游标漂移→页边界重复/漏行;reset 从第 1 页新鲜重建。 */
function invalidateBookmarksAndFolders(queryClient: ReturnType<typeof useQueryClient>) {
  return Promise.all([
    queryClient.resetQueries({ queryKey: [BOOKMARKS_QUERY_KEY] }),
    queryClient.invalidateQueries({ queryKey: FOLDERS_KEY }),
  ])
}

/** 书签 mutation 统一失败 toast,按错误类型给可执行的提示文案。 */
function useMutationErrorToast() {
  const { t } = useTranslation('common')
  const toast = useToastStore.getState()
  return (error?: unknown) => toast.error(describeMutationError(error, t))
}

/** 书签列表(单页快照)。书签变化不频繁,staleTime 5 分钟。 */
export function useBookmarks(params?: BookmarkQueryParams) {
  return useQuery({
    queryKey: [BOOKMARKS_QUERY_KEY, params],
    queryFn: () => bookmarksService.getBookmarks(params),
    // 跨端同步可见性:扩展端写入后 Web 端最长 5 分钟内反映(此前 30 分钟,
    // 容易被当成"丢数据");焦点回归时对过期页面自动重取。
    staleTime: 5 * 60 * 1000,
    gcTime: 24 * 60 * 60 * 1000,
    refetchOnWindowFocus: true,
  })
}

/** 游标分页无限滚动;getNextPageParam 取 lastPage.meta。 */
export function useInfiniteBookmarks(params?: BookmarkQueryParams) {
  return useInfiniteQuery({
    queryKey: [BOOKMARKS_QUERY_KEY, params],
    queryFn: ({ pageParam }) =>
      bookmarksService.getBookmarks({
        ...params,
        page_cursor: typeof pageParam === 'string' ? pageParam : undefined,
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => (lastPage.meta?.has_more ? lastPage.meta.next_cursor : undefined),
    staleTime: 5 * 60 * 1000,
    gcTime: 24 * 60 * 60 * 1000,
    refetchOnWindowFocus: true,
  })
}

/** 创建书签;成功后失效书签、标签、文件夹缓存。 */
export function useCreateBookmark() {
  const queryClient = useQueryClient()
  const onError = useMutationErrorToast()
  return useMutation({
    mutationFn: (data: CreateBookmarkInput) => bookmarksService.createBookmark(data),
    onSuccess: async () => {
      await invalidateBookmarksAndFolders(queryClient)
      await queryClient.invalidateQueries({ queryKey: ['tags'] })
    },
    onError,
  })
}

/** 更新书签;成功后失效书签、标签、文件夹缓存。 */
export function useUpdateBookmark() {
  const queryClient = useQueryClient()
  const onError = useMutationErrorToast()
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateBookmarkInput }) =>
      bookmarksService.updateBookmark(id, data),
    onSuccess: async () => {
      await invalidateBookmarksAndFolders(queryClient)
      await queryClient.invalidateQueries({ queryKey: ['tags'] })
    },
    onError,
  })
}

/** 书签列表缓存形状:useInfiniteQuery 的 InfiniteData(含 pages)或 useQuery 的单页 BookmarksResponse。 */
type BookmarksCache = BookmarksResponse | InfiniteData<BookmarksResponse, string | undefined>

/** 对一份缓存(无限分页或单页)应用 bookmarks 变换,返回新对象(不可变);未加载时原样返回,不写入。 */
function mapCachedBookmarks(
  data: BookmarksCache | undefined,
  fn: (bookmarks: BookmarkDTO[]) => BookmarkDTO[],
): BookmarksCache | undefined {
  if (!data) return data
  if ('pages' in data) {
    return { ...data, pages: data.pages.map((p) => ({ ...p, bookmarks: fn(p.bookmarks) })) }
  }
  return { ...data, bookmarks: fn(data.bookmarks) }
}

/** 置顶区乐观重排:把 is_pinned 条目按 bookmarkIds 顺序就地替换占位并写入新 pin_order(0-based);未覆盖的置顶条目保持原位,非置顶条目不动。无置顶时返回原数组。 */
function reorderPinnedOptimistic(bookmarks: BookmarkDTO[], bookmarkIds: string[]): BookmarkDTO[] {
  if (bookmarkIds.length === 0) return bookmarks
  const pinnedIds = bookmarks.filter((b) => b.is_pinned).map((b) => b.id)
  if (pinnedIds.length === 0) return bookmarks
  const orderMap = new Map<string, number>(bookmarkIds.map((id, i) => [id, i]))
  const byId = new Map<string, BookmarkDTO>(bookmarks.map((b) => [b.id, b]))
  const orderedIds = [
    ...bookmarkIds.filter((id) => pinnedIds.includes(id)),
    ...pinnedIds.filter((id) => !orderMap.has(id)),
  ]
  let cursor = 0
  return bookmarks.map((b) => {
    if (!b.is_pinned) return b
    const newId = orderedIds[cursor]
    cursor += 1
    if (!newId) return b
    const src = byId.get(newId) ?? b
    const pin_order = orderMap.has(newId) ? (orderMap.get(newId) as number) : src.pin_order
    return src === b && pin_order === b.pin_order ? b : { ...src, pin_order }
  })
}

/** 同文件夹 manual 排序乐观重排:按 updates 的新 position 更新对应条目再按 position 升序排序(重建拖拽后顺序);无命中则返回原数组。 */
function reorderBookmarksOptimistic(bookmarks: BookmarkDTO[], updates: ReorderBookmarkItem[]): BookmarkDTO[] {
  if (updates.length === 0) return bookmarks
  const posMap = new Map<string, number>(updates.map((u) => [u.id, u.position]))
  if (!bookmarks.some((b) => posMap.has(b.id))) return bookmarks
  return bookmarks
    .map((b) => (posMap.has(b.id) ? { ...b, position: posMap.get(b.id) as number } : b))
    .sort((a, b) => a.position - b.position)
}

/** 重排置顶书签顺序(POST /bookmarks/reorder-pinned,设 pin_order);乐观重排缓存内 is_pinned 子集,失败回滚 + toast。 */
export function useReorderPinned() {
  const queryClient = useQueryClient()
  const showErrorToast = useMutationErrorToast()
  return useMutation({
    mutationFn: (data: ReorderPinnedInput) => bookmarksService.reorderPinned(data),
    onMutate: async (data) => {
      await queryClient.cancelQueries({ queryKey: [BOOKMARKS_QUERY_KEY] })
      const snapshot = queryClient.getQueriesData<BookmarksCache>({ queryKey: [BOOKMARKS_QUERY_KEY] })
      queryClient.setQueriesData<BookmarksCache>({ queryKey: [BOOKMARKS_QUERY_KEY] }, (old) =>
        mapCachedBookmarks(old, (b) => reorderPinnedOptimistic(b, data.bookmark_ids)),
      )
      return { snapshot }
    },
    onSuccess: () => invalidateBookmarksAndFolders(queryClient),
    onError: (_err, _vars, ctx) => {
      ctx?.snapshot.forEach(([k, v]) => v !== undefined && queryClient.setQueryData(k, v))
      showErrorToast()
    },
  })
}

/** 批量重排书签 position(POST /bookmarks/reorder,条目 DnD 同文件夹重排);乐观按新 position 重排当前页,失败回滚 + toast。 */
export function useReorderBookmarks() {
  const queryClient = useQueryClient()
  const showErrorToast = useMutationErrorToast()
  return useMutation({
    mutationFn: (data: ReorderBookmarksInput) => bookmarksService.reorderBookmarks(data),
    onMutate: async (data) => {
      await queryClient.cancelQueries({ queryKey: [BOOKMARKS_QUERY_KEY] })
      const snapshot = queryClient.getQueriesData<BookmarksCache>({ queryKey: [BOOKMARKS_QUERY_KEY] })
      queryClient.setQueriesData<BookmarksCache>({ queryKey: [BOOKMARKS_QUERY_KEY] }, (old) =>
        mapCachedBookmarks(old, (b) => reorderBookmarksOptimistic(b, data.updates)),
      )
      return { snapshot }
    },
    onSuccess: () => invalidateBookmarksAndFolders(queryClient),
    onError: (_err, _vars, ctx) => {
      ctx?.snapshot.forEach(([k, v]) => v !== undefined && queryClient.setQueryData(k, v))
      showErrorToast()
    },
  })
}

/** 软删书签(移入回收站)。 */
export function useDeleteBookmark() {
  const queryClient = useQueryClient()
  const onError = useMutationErrorToast()
  return useMutation({
    mutationFn: (id: string) => bookmarksService.deleteBookmark(id),
    onSuccess: async () => {
      await invalidateBookmarksAndFolders(queryClient)
      await queryClient.invalidateQueries({ queryKey: ['tags'] })
    },
    onError,
  })
}

/** 从回收站恢复书签。 */
export function useRestoreFromTrash() {
  const queryClient = useQueryClient()
  const onError = useMutationErrorToast()
  return useMutation({
    mutationFn: (id: string) => bookmarksService.restoreFromTrash(id),
    // Tag bookmark_count excludes soft-deleted bookmarks; restoring shifts it.
    onSuccess: async () => {
      await invalidateBookmarksAndFolders(queryClient)
      await queryClient.invalidateQueries({ queryKey: ['tags'] })
    },
    onError,
  })
}

/** 永久删除回收站书签。 */
export function usePermanentDelete() {
  const queryClient = useQueryClient()
  const onError = useMutationErrorToast()
  return useMutation({
    mutationFn: (id: string) => bookmarksService.permanentDelete(id),
    onSuccess: async () => {
      await invalidateBookmarksAndFolders(queryClient)
      await queryClient.invalidateQueries({ queryKey: ['tags'] })
    },
    onError,
  })
}

/**
 * 记录书签点击(无失效,fire-and-forget)。
 *
 * 刻意不是 hook:它不读也不写查询缓存,做成 useMutation 会让列表里每一行都挂一个
 * mutation observer(每页最多 200 行),纯属浪费。失败无声忽略——点击统计丢一条
 * 不值得打扰用户。
 */
export function recordBookmarkClick(id: string): void {
  void bookmarksService.recordClick(id).catch(() => undefined)
}

type BatchAction = 'delete' | 'pin' | 'unpin' | 'update_tags' | 'todo' | 'untodo' | 'archive' | 'unarchive' | 'move'
interface BatchActionParams {
  action: BatchAction
  bookmarks: BookmarkDTO[]
  add_tag_ids?: string[]
  remove_tag_ids?: string[]
  folder_id?: string | null
}
interface BatchActionResult {
  successCount: number
  failedCount: number
}

/** Execute one backend bulk action so the selection is updated atomically. */
export function useBatchAction() {
  const queryClient = useQueryClient()
  const onError = useMutationErrorToast()
  return useMutation({
    mutationFn: async ({ action, bookmarks, add_tag_ids, remove_tag_ids, folder_id }: BatchActionParams) => {
      const result = await bookmarksService.batchAction({
        action,
        bookmark_ids: bookmarks.map((bookmark) => bookmark.id),
        ...(add_tag_ids?.length ? { add_tag_ids } : {}),
        ...(remove_tag_ids?.length ? { remove_tag_ids } : {}),
        ...(action === 'move' ? { folder_id: folder_id ?? null } : {}),
      })
      return {
        successCount: result.affected_count,
        failedCount: result.errors?.length ?? 0,
      } satisfies BatchActionResult
    },
    onSuccess: async () => {
      await invalidateBookmarksAndFolders(queryClient)
      await queryClient.invalidateQueries({ queryKey: ['tags'] })
    },
    onError,
  })
}

/** 清空回收站:一次请求永久删除当前用户的全部回收站书签。 */
export function useEmptyTrash() {
  const queryClient = useQueryClient()
  const onError = useMutationErrorToast()
  return useMutation({
    mutationFn: () => bookmarksService.emptyTrash(),
    onSuccess: async () => {
      await invalidateBookmarksAndFolders(queryClient)
      await queryClient.invalidateQueries({ queryKey: ['tags'] })
    },
    onError,
  })
}
