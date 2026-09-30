import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { bookmarkFoldersService } from '@/services/bookmark-folders'
import type {
  CreateBookmarkFolderInput,
  ReorderBookmarkFoldersInput,
  UpdateBookmarkFolderInput,
} from '@tmarks/contracts'

const BOOKMARK_FOLDERS_QUERY_KEY = 'bookmark-folders'

export function useBookmarkFolders() {
  return useQuery({
    queryKey: [BOOKMARK_FOLDERS_QUERY_KEY],
    queryFn: () => bookmarkFoldersService.getFolders(),
    staleTime: 5 * 60 * 1000,
  })
}

export function useCreateBookmarkFolder() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: CreateBookmarkFolderInput) => bookmarkFoldersService.createFolder(data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [BOOKMARK_FOLDERS_QUERY_KEY] }),
  })
}

export function useUpdateBookmarkFolder() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateBookmarkFolderInput }) =>
      bookmarkFoldersService.updateFolder(id, data),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: [BOOKMARK_FOLDERS_QUERY_KEY] })
      // BookmarkDTO embeds folder_path; a rename/move leaves every cached
      // bookmark page stale otherwise (delete below already invalidates).
      await queryClient.invalidateQueries({ queryKey: ['bookmarks'] })
    },
  })
}

export function useDeleteBookmarkFolder() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => bookmarkFoldersService.deleteFolder(id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: [BOOKMARK_FOLDERS_QUERY_KEY] })
      await queryClient.invalidateQueries({ queryKey: ['bookmarks'] })
    },
  })
}

/**
 * Batch sibling reorder (R5-13): one request for the whole order instead of
 * one PATCH per sibling. Position-only changes do not touch folder_path or
 * any cached bookmark data, so this invalidates ONLY the folder list — the
 * old per-sibling path also reset the bookmarks cache N times per drag.
 */
export function useReorderBookmarkFolders() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: ReorderBookmarkFoldersInput) => bookmarkFoldersService.reorderFolders(data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [BOOKMARK_FOLDERS_QUERY_KEY] }),
  })
}
