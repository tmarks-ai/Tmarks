import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { snapshotsService } from '@/services/snapshots'

const SNAPSHOTS_QUERY_KEY = 'bookmark-snapshots'

/** 书签快照列表;enabled 仅当有 bookmarkId。 */
export function useBookmarkSnapshots(bookmarkId: string | null) {
  return useQuery({
    queryKey: [SNAPSHOTS_QUERY_KEY, bookmarkId],
    queryFn: () => snapshotsService.list(bookmarkId!),
    enabled: Boolean(bookmarkId),
    staleTime: 60 * 1000,
  })
}

/** 删除快照;成功后失效快照列表与书签缓存。 */
export function useDeleteSnapshot() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ bookmarkId, snapshotId }: { bookmarkId: string; snapshotId: string }) =>
      snapshotsService.remove(bookmarkId, snapshotId),
    onSuccess: (_data, { bookmarkId }) => {
      void queryClient.invalidateQueries({ queryKey: [SNAPSHOTS_QUERY_KEY, bookmarkId] })
      void queryClient.invalidateQueries({ queryKey: ['bookmarks'] })
    },
  })
}
