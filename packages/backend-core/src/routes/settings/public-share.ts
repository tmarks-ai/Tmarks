import { Hono } from 'hono'
import type { Context } from 'hono'
import type { AppEnv } from '../../lib/env'
import { getPublicShareSettings, PublicShareSettingsError, updatePublicShareSettings } from '../../lib/share'
import { badRequest, conflict, internalError, success } from '../../lib/response'
import { requireAuth } from '../../middleware/auth'
import type { UpdatePublicShareSettingsInput } from '@tmarks/contracts'

async function getSettingsHandler(c: Context<AppEnv>): Promise<Response> {
  const auth = c.get('auth')
  if (!auth) return internalError('User not found')
  try {
    return success({ share: await getPublicShareSettings(c.env.DB, auth.user_id) })
  } catch (error) {
    console.error('Failed to load public share settings:', error)
    return internalError('Failed to load public share settings')
  }
}

async function updateSettingsHandler(c: Context<AppEnv>): Promise<Response> {
  const auth = c.get('auth')
  if (!auth) return internalError('User not found')
  try {
    const input = await c.req.json<UpdatePublicShareSettingsInput>()
    return success({ share: await updatePublicShareSettings(c.env.DB, auth.user_id, input) })
  } catch (error) {
    if (error instanceof PublicShareSettingsError) {
      return error.status === 409 ? conflict(error.message, error.code) : badRequest(error.message, error.code)
    }
    console.error('Failed to update public share settings:', error)
    return internalError('Failed to update public share settings')
  }
}

export const publicShareRoutes = new Hono<AppEnv>()
publicShareRoutes.use('/', requireAuth)
publicShareRoutes.get('/', getSettingsHandler)
publicShareRoutes.put('/', updateSettingsHandler)
