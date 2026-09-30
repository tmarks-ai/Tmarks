import { Hono } from 'hono'
import type { Context } from 'hono'
import type { AppEnv } from '../../lib/env'
import { badRequest, internalError, notFound, success } from '../../lib/response'
import { requireAuth } from '../../middleware/auth'
import {
  deleteApiKeyHard,
  getApiKeyDetail,
  revokeApiKey,
  updateApiKey,
  type UpdateApiKeyInput,
} from '../../lib/api-key'
import { getApiKeyStats } from '../../lib/api-key'

async function getApiKeyHandler(c: Context<AppEnv>): Promise<Response> {
  const auth = c.get('auth')
  if (!auth) return internalError('User not found')
  const keyId = c.req.param('id')
  if (!keyId) return notFound('API Key not found')
  try {
    const data = await getApiKeyDetail(c.env.DB, auth.user_id, keyId)
    if (!data) return notFound('API Key not found')
    const stats = await getApiKeyStats(keyId, auth.user_id, c.env.DB)
    return success({ ...data, stats })
  } catch (error) {
    console.error('Failed to get API key:', error)
    return internalError('Failed to get API key details')
  }
}

async function updateApiKeyHandler(c: Context<AppEnv>): Promise<Response> {
  const auth = c.get('auth')
  if (!auth) return internalError('User not found')
  const keyId = c.req.param('id')
  if (!keyId) return notFound('API Key not found')
  try {
    const body = await c.req.json<UpdateApiKeyInput>()
    const result = await updateApiKey(c.env.DB, auth.user_id, keyId, body)
    if (result === null) return notFound('API Key not found')
    if (!result.ok) return badRequest({ code: result.error.code, message: result.error.message })
    return success(result.data)
  } catch (error) {
    console.error('Failed to update API key:', error)
    return internalError('Failed to update API key')
  }
}

async function deleteApiKeyHandler(c: Context<AppEnv>): Promise<Response> {
  const auth = c.get('auth')
  if (!auth) return internalError('User not found')
  const keyId = c.req.param('id')
  if (!keyId) return notFound('API Key not found')
  const hardDelete = new URL(c.req.url).searchParams.get('hard') === 'true'
  try {
    const ok = hardDelete
      ? await deleteApiKeyHard(c.env.DB, auth.user_id, keyId)
      : await revokeApiKey(c.env.DB, auth.user_id, keyId)
    if (!ok) return notFound('API Key not found')
    try {
      await c.env.DB
        .prepare(
          `INSERT INTO audit_logs (user_id, event_type, payload, created_at)
           VALUES (?, 'api_key.revoked', ?, ?)`
        )
        .bind(auth.user_id, JSON.stringify({ key_id: keyId, hard_delete: hardDelete === true }), new Date().toISOString())
        .run()
    } catch {
      /* audit is best-effort */
    }
    return success({ message: hardDelete ? 'API Key deleted permanently' : 'API Key revoked successfully' })
  } catch (error) {
    console.error('Failed to revoke API key:', error)
    return internalError('Failed to revoke API key')
  }
}

/**
 * Single API key detail/update/delete (revoke soft, `?hard=true` hard). Same
 * guards as the collection. Mounted under /settings/api-keys/:id.
 */
export const apiKeyIdRoutes = new Hono<AppEnv>()

apiKeyIdRoutes.use('/', requireAuth)
apiKeyIdRoutes.get('/', getApiKeyHandler)
apiKeyIdRoutes.patch('/', updateApiKeyHandler)
apiKeyIdRoutes.delete('/', deleteApiKeyHandler)
