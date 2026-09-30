import { Hono } from 'hono'
import type { AppEnv } from '../../lib/env'
import { requireDataAuth } from '../../middleware/data-auth'
import { listBookmarksHandler } from './list'
import { createBookmarkHandler } from './create'
import { batchCreateHandler } from './batch-create'
import { bulkBookmarksHandler } from './bulk'
import { listTrashHandler } from './trash-list'
import { emptyTrashHandler } from './empty-trash'
import { reorderPinnedHandler } from './reorder-pinned'
import { reorderBookmarksHandler } from './reorder'
import { bookmarkStatisticsHandler } from './statistics'
import { checkUrlHandler } from './check-url'
import { urlMetadataHandler } from './url-metadata'
import { bookmarkIdRoutes } from './id'

/**
 * Shared bookmark routes. Mounted at /api/v1/bookmarks.
 * Static sub-paths (/trash, /reorder-pinned) are registered before the /:id
 * param route so they take precedence.
 */
export const bookmarkListRoutes = new Hono<AppEnv>()

bookmarkListRoutes.get('/', requireDataAuth('bookmarks.read'), listBookmarksHandler)
bookmarkListRoutes.post('/', requireDataAuth('bookmarks.create'), createBookmarkHandler)
bookmarkListRoutes.get('/trash', requireDataAuth('bookmarks.read'), listTrashHandler)
bookmarkListRoutes.post('/trash/empty', requireDataAuth('bookmarks.delete'), emptyTrashHandler)
bookmarkListRoutes.post('/batch', requireDataAuth('bookmarks.create'), batchCreateHandler)
// Route-level gate is the read permission; the handler enforces per-action
// permissions (delete/update/tags.assign) for API-key callers via
// permissionsFor(action), so a read-only key can't sneak a write through.
bookmarkListRoutes.post('/bulk', requireDataAuth('bookmarks.read'), bulkBookmarksHandler)
bookmarkListRoutes.post('/reorder-pinned', requireDataAuth('bookmarks.update'), reorderPinnedHandler)
bookmarkListRoutes.post('/reorder', requireDataAuth('bookmarks.update'), reorderBookmarksHandler)
bookmarkListRoutes.get('/statistics', requireDataAuth('bookmarks.read'), bookmarkStatisticsHandler)
bookmarkListRoutes.get('/check-url', requireDataAuth('bookmarks.read'), checkUrlHandler)
// Server-side page fetch for the add-bookmark form (title/favicon/og:image).
// Static sub-path — must stay above the /:id param route.
bookmarkListRoutes.get('/url-metadata', requireDataAuth('bookmarks.read'), urlMetadataHandler)
bookmarkListRoutes.route('/:id', bookmarkIdRoutes)
