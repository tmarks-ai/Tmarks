import { Hono } from 'hono'
import type { AppEnv } from '../../lib/env'
import { requireDataAuth } from '../../middleware/data-auth'
import { listFoldersHandler } from './list'
import { createFolderHandler } from './create'
import { updateFolderHandler } from './update'
import { deleteFolderHandler } from './delete'
import { reorderFoldersHandler } from './reorder'

/**
 * Bookmark-folder routes, mounted at /api/v1/bookmark-folders. Read access
 * uses `bookmark_folders.read`; writes use the matching create/update/delete
 * permissions.
 */
export const folderRoutes = new Hono<AppEnv>()

folderRoutes.get('/', requireDataAuth('bookmark_folders.read'), listFoldersHandler)
folderRoutes.post('/', requireDataAuth('bookmark_folders.create'), createFolderHandler)
folderRoutes.post('/reorder', requireDataAuth('bookmark_folders.update'), reorderFoldersHandler)
folderRoutes.patch('/:id', requireDataAuth('bookmark_folders.update'), updateFolderHandler)
folderRoutes.delete('/:id', requireDataAuth('bookmark_folders.delete'), deleteFolderHandler)
