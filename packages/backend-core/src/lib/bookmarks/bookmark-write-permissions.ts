import type { AuthContext } from '../env'
import { requireApiKeyPermissions } from '../api-key'
import type { BatchCreateBookmarkInput } from './bookmark-batch'

interface BookmarkWriteInput {
  folder_path?: string[]
  tags?: string[]
  tag_ids?: string[]
}

/**
 * Enforce API-key permissions for a single bookmark write. Returns a 403
 * Response when the authenticated API key is missing a required capability, or
 * null when the request is JWT-authenticated (JWT has full access).
 */
export function requireBookmarkCreatePermissions(
  auth: AuthContext,
  input: BookmarkWriteInput
): Response | null {
  return requireApiKeyPermissions(auth, getBookmarkWritePermissions(input))
}

/**
 * Enforce API-key permissions for a batch create: the union of capabilities
 * required across every item in the batch.
 */
export function requireBookmarkBatchCreatePermissions(
  auth: AuthContext,
  bookmarks: BatchCreateBookmarkInput[]
): Response | null {
  const required = new Set<string>()
  for (const bookmark of bookmarks) {
    for (const permission of getBookmarkWritePermissions(bookmark)) {
      required.add(permission)
    }
  }

  return requireApiKeyPermissions(auth, [...required])
}

export function requireBookmarkUpdatePermissions(
  auth: AuthContext,
  input: BookmarkWriteInput
): Response | null {
  return requireApiKeyPermissions(auth, getBookmarkWritePermissions(input))
}

function getBookmarkWritePermissions(input: BookmarkWriteInput): string[] {
  const permissions: string[] = []

  if (Array.isArray(input.folder_path) && input.folder_path.length > 0) {
    // folder_path auto-creates missing folders (resolveBookmarkFolderPath), so
    // it must not be a way around the bookmark_folders.create capability.
    permissions.push('bookmarks.update', 'bookmark_folders.create')
  }
  if (input.tags !== undefined) {
    permissions.push('tags.create', 'tags.assign')
  }
  if (input.tag_ids !== undefined) {
    permissions.push('tags.assign')
  }

  return permissions
}
