import type { Context } from 'hono'
import type { AppEnv } from '../../lib/env'
import { success, internalError } from '../../lib/response'
import { buildFolderTree, fetchBookmarkFolders, fetchBookmarkFolderStats } from '../../lib/bookmarks'

/** GET / — list the user's bookmark folders as a tree + flat list + stats. */
export async function listFoldersHandler(c: Context<AppEnv>): Promise<Response> {
  const auth = c.get('auth')
  if (!auth) return internalError('User not found')
  const userId = auth.user_id

  try {
    const folders = await fetchBookmarkFolders(c.env.DB, userId)
    const stats = await fetchBookmarkFolderStats(c.env.DB, userId)
    return success({
      folders: buildFolderTree(folders),
      flat_folders: folders,
      ...stats,
    })
  } catch (error) {
    console.error('List bookmark folders error:', error)
    return internalError('Failed to load bookmark folders')
  }
}
