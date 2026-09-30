import { Hono } from 'hono'
import type { AppEnv } from '../../../lib/env'
import { requireDataAuth } from '../../../middleware/data-auth'
import { getBookmarkHandler } from './get'
import { updateBookmarkHandler } from './update'
import { deleteBookmarkHandler } from './delete'
import { restoreBookmarkHandler } from './restore'
import { permanentDeleteHandler } from './permanent'
import { trashBookmarkHandler } from './trash'
import { clickBookmarkHandler } from './click'
import { snapshotRoutes } from './snapshots'

/**
 * Per-bookmark routes, mounted at /:id under each bookmarks entrance. Static
 * sub-paths (restore, permanent, trash, click) are registered explicitly so
 * they take precedence over the bare `/:id` segment.
 */
export const bookmarkIdRoutes = new Hono<AppEnv>()

bookmarkIdRoutes.get('/', requireDataAuth('bookmarks.read'), getBookmarkHandler)
bookmarkIdRoutes.patch('/', requireDataAuth('bookmarks.update'), updateBookmarkHandler)
bookmarkIdRoutes.delete('/', requireDataAuth('bookmarks.delete'), deleteBookmarkHandler)
bookmarkIdRoutes.patch('/restore', requireDataAuth('bookmarks.update'), restoreBookmarkHandler)
bookmarkIdRoutes.delete('/permanent', requireDataAuth('bookmarks.delete'), permanentDeleteHandler)
bookmarkIdRoutes.patch('/trash', requireDataAuth('bookmarks.delete'), trashBookmarkHandler)
bookmarkIdRoutes.post('/click', requireDataAuth('bookmarks.update'), clickBookmarkHandler)
bookmarkIdRoutes.route('/snapshots', snapshotRoutes)
