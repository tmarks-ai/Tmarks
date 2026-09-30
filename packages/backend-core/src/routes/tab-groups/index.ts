import { Hono } from 'hono'
import type { AppEnv } from '../../lib/env'
import { requireDataAuth } from '../../middleware/data-auth'
import { listTabGroupsHandler } from './list'
import { createTabGroupHandler } from './create'
import { trashTabGroupsHandler } from './trash'
import { batchUpdateTabGroupsHandler } from './batch-update'
import {
  getTabGroupHandler,
  updateTabGroupHandler,
  deleteTabGroupHandler,
} from './group-id'
import {
  permanentDeleteTabGroupHandler,
  restoreTabGroupHandler,
} from './group-lifecycle'
import { groupItemsBatchAddHandler } from './group-items-batch'
import { itemsBatchHandler } from './items-batch'
import {
  updateTabGroupItemHandler,
  deleteTabGroupItemHandler,
} from './items-id'
import { moveTabGroupItemHandler } from './items-move'
import { dedupTabGroupHandler } from './dedup'

/**
 * Tab-group routes, mounted at /api/v1/tab-groups.
 * Group reads/writes use the `tab_groups.*` permissions; item management is
 * gated on `tab_groups.update` (and `tab_groups.create` for adding items).
 */
export const tabGroupsRoutes = new Hono<AppEnv>()

// Static paths first (Hono prefers static over the /:id param at the same level).
tabGroupsRoutes.get('/', requireDataAuth('tab_groups.read'), listTabGroupsHandler)
tabGroupsRoutes.post('/', requireDataAuth('tab_groups.create'), createTabGroupHandler)
tabGroupsRoutes.get('/trash', requireDataAuth('tab_groups.read'), trashTabGroupsHandler)
tabGroupsRoutes.patch('/batch-update', requireDataAuth('tab_groups.update'), batchUpdateTabGroupsHandler)

// Top-level item routes (addressed by item id, no group in the path).
tabGroupsRoutes.post('/items/batch', requireDataAuth('tab_groups.update'), itemsBatchHandler)

const itemItemRoutes = new Hono<AppEnv>()
itemItemRoutes.patch('/', requireDataAuth('tab_groups.update'), updateTabGroupItemHandler)
itemItemRoutes.delete('/', requireDataAuth('tab_groups.update'), deleteTabGroupItemHandler)
itemItemRoutes.post('/move', requireDataAuth('tab_groups.update'), moveTabGroupItemHandler)
tabGroupsRoutes.route('/items/:itemId', itemItemRoutes)

// Group-scoped routes (/:id/*).
const groupIdRoutes = new Hono<AppEnv>()
groupIdRoutes.get('/', requireDataAuth('tab_groups.read'), getTabGroupHandler)
groupIdRoutes.patch('/', requireDataAuth('tab_groups.update'), updateTabGroupHandler)
groupIdRoutes.delete('/', requireDataAuth('tab_groups.delete'), deleteTabGroupHandler)
groupIdRoutes.delete('/permanent-delete', requireDataAuth('tab_groups.delete'), permanentDeleteTabGroupHandler)
groupIdRoutes.post('/restore', requireDataAuth('tab_groups.update'), restoreTabGroupHandler)
groupIdRoutes.post('/items/batch', requireDataAuth('tab_groups.create'), groupItemsBatchAddHandler)
groupIdRoutes.post('/dedup', requireDataAuth('tab_groups.update'), dedupTabGroupHandler)
tabGroupsRoutes.route('/:id', groupIdRoutes)
