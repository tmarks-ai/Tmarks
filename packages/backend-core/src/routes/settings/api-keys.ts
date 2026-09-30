import { Hono } from 'hono'
import type { Context } from 'hono'
import type { AppEnv } from '../../lib/env'
import { badRequest, created, internalError, success } from '../../lib/response'
import { requireAuth } from '../../middleware/auth'
import {
  createApiKey,
  getUserApiKeyLimit,
  listApiKeys,
  type CreateApiKeyInput,
} from '../../lib/api-key'

async function listApiKeysHandler(c: Context<AppEnv>): Promise<Response> {
  const auth = c.get('auth')
  if (!auth) return internalError('User not found')
  try {
    const limit = getUserApiKeyLimit(c.env)
    return success(await listApiKeys(c.env.DB, auth.user_id, limit))
  } catch (error) {
    console.error('Failed to list API keys:', error)
    return internalError('Failed to list API keys')
  }
}

async function createApiKeyHandler(c: Context<AppEnv>): Promise<Response> {
  const auth = c.get('auth')
  if (!auth) return internalError('User not found')
  try {
    const body = await c.req.json<CreateApiKeyInput>()
    const limit = getUserApiKeyLimit(c.env)
    const result = await createApiKey(c.env.DB, auth.user_id, body, limit)
    if (!result.ok) {
      return badRequest({
        code: result.error.code,
        message: result.error.message,
        ...(result.error.quota ? { quota: result.error.quota } : {}),
      })
    }
    // 审计只记 id/前缀:密钥明文绝不落任何存储。
    try {
      await c.env.DB
        .prepare(
          `INSERT INTO audit_logs (user_id, event_type, payload, created_at)
           VALUES (?, 'api_key.created', ?, ?)`
        )
        .bind(auth.user_id, JSON.stringify({ key_id: result.data.id, key_prefix: result.data.key_prefix }), new Date().toISOString())
        .run()
    } catch {
      /* audit is best-effort */
    }

    // 明文 key 仅在创建响应返回一次(ApiKeyCreatedResponse.key),
    // Web 设置页借此展示「仅此一次」的扩展密钥。
    return created({ ...result.data, key: result.key })
  } catch (error) {
    console.error('Failed to create API key:', error)
    return internalError('Failed to create API key')
  }
}

/**
 * API key collection (list + create). This is a Web control-plane endpoint:
 * it requires the independent Web login and is not available to Tab keys.
 */
export const apiKeysRoutes = new Hono<AppEnv>()

apiKeysRoutes.use('/', requireAuth)
apiKeysRoutes.get('/', listApiKeysHandler)
apiKeysRoutes.post('/', createApiKeyHandler)
