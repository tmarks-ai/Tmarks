import { Hono } from 'hono'
import { getEnvironment } from '../lib/config'
import type { AppEnv } from '../lib/env'
import { requireDataAuth } from '../middleware/data-auth'
import { authRoutes } from './auth'
import { bookmarkListRoutes } from './bookmarks'
import { changePasswordRoutes } from './change-password'
import { exportRoutes } from './export'
import { folderRoutes } from './folders'
import { meHandler } from './me'
import { tagRoutes } from './tags'
import { tabGroupsRoutes } from './tab-groups'
import { preferencesRoutes } from './preferences'
import { searchHandler } from './search'
import { settingsRoutes } from './settings'
import { syncRoutes } from './sync'

export const v1Routes = new Hono<AppEnv>()

v1Routes.get('/health', (c) => {
  return c.json({ status: 'ok', environment: getEnvironment(c.env) })
})

v1Routes.route('/auth', authRoutes)
v1Routes.route('/bookmarks', bookmarkListRoutes)
v1Routes.route('/bookmark-folders', folderRoutes)
v1Routes.route('/tags', tagRoutes)
v1Routes.route('/tab-groups', tabGroupsRoutes)
v1Routes.route('/preferences', preferencesRoutes)
v1Routes.get('/search', requireDataAuth('bookmarks.read'), searchHandler)
v1Routes.get('/me', requireDataAuth('user.read'), meHandler)
v1Routes.route('/sync', syncRoutes)
v1Routes.route('/change-password', changePasswordRoutes)
v1Routes.route('/export', exportRoutes)
v1Routes.route('/settings', settingsRoutes)
