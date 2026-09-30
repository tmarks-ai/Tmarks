import { Hono } from 'hono'
import type { AppEnv } from '../../lib/env'
import { apiKeysRoutes } from './api-keys'
import { apiKeyIdRoutes } from './api-key-id'
import { apiKeyLogsRoutes } from './api-key-logs'
import { publicShareRoutes } from './public-share'

/**
 * Settings entry: Web-only API key management and public-share settings.
 * Mounted at /settings on the canonical v1 entrance.
 */
export const settingsRoutes = new Hono<AppEnv>()

settingsRoutes.route('/api-keys', apiKeysRoutes)
settingsRoutes.route('/api-keys/:id', apiKeyIdRoutes)
settingsRoutes.route('/api-keys/:id/logs', apiKeyLogsRoutes)
settingsRoutes.route('/public-share', publicShareRoutes)
