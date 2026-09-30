import { Hono } from 'hono'
import type { Context } from 'hono'
import type { AppEnv } from '../../lib/env'
import { internalError, notFound, success } from '../../lib/response'
import { requireAuth } from '../../middleware/auth'
import { getApiKeyDetail, getApiKeyLogs } from '../../lib/api-key'

async function getApiKeyLogsHandler(c: Context<AppEnv>): Promise<Response> {
  const auth = c.get('auth')
  if (!auth) return internalError('User not found')
  const keyId = c.req.param('id')
  if (!keyId) return notFound('API Key not found')
  try {
    const url = new URL(c.req.url)
    const limit = Math.max(1, Math.min(parseInt(url.searchParams.get('limit') || '10', 10) || 10, 100))
    const key = await getApiKeyDetail(c.env.DB, auth.user_id, keyId)
    if (!key) return notFound('API Key not found')
    const logs = await getApiKeyLogs(keyId, auth.user_id, c.env.DB, limit)
    return success({ logs })
  } catch (error) {
    console.error('Failed to get API key logs:', error)
    return internalError('Failed to get API key logs')
  }
}

/** `GET /api-keys/:id/logs` — paginated API key usage logs. */
export const apiKeyLogsRoutes = new Hono<AppEnv>()

apiKeyLogsRoutes.use('/', requireAuth)
apiKeyLogsRoutes.get('/', getApiKeyLogsHandler)
