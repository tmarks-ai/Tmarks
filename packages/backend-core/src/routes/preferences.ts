import { Hono } from 'hono'
import type { Context } from 'hono'
import type { AppEnv } from '../lib/env'
import { badRequest, internalError, success } from '../lib/response'
import { requireDataAuth } from '../middleware/data-auth'
import { emitSyncChange } from '../lib/sync/sync-emit'
import type { UpdatePreferencesInput } from '@tmarks/contracts'
import {
  mapPreferences,
  validatePreferences,
  type UserPreferences,
} from '../lib/preferences'

/**
 * Preferences routes, mounted at /api/v1/preferences. All `user_preferences`
 * columns exist by virtue of the
 * single-sourced schema + migration gate, so the legacy per-column existence
 * probes are dropped (no fail-open): every provided field is written directly.
 */
export const preferencesRoutes = new Hono<AppEnv>()

async function getPreferencesHandler(c: Context<AppEnv>): Promise<Response> {
  const auth = c.get('auth')
  if (!auth) return internalError('User not found')
  const userId = auth.user_id

  try {
    let row = await c.env.DB
      .prepare('SELECT * FROM user_preferences WHERE user_id = ?')
      .bind(userId)
      .first<UserPreferences>()
    if (!row) {
      // First access for a new user — create default preferences row (every
      // column has a DEFAULT in the schema) and read it back.
      await c.env.DB
        .prepare('INSERT INTO user_preferences (user_id) VALUES (?) ON CONFLICT(user_id) DO NOTHING')
        .bind(userId)
        .run()
      row = await c.env.DB
        .prepare('SELECT * FROM user_preferences WHERE user_id = ?')
        .bind(userId)
        .first<UserPreferences>()
    }
    if (!row) return internalError('Failed to load preferences')
    return success({ preferences: mapPreferences(row) })
  } catch (error) {
    console.error('Get preferences error:', error)
    return internalError('Failed to get preferences')
  }
}

export async function updatePreferencesHandler(c: Context<AppEnv>): Promise<Response> {
  const auth = c.get('auth')
  if (!auth) return internalError('User not found')
  const userId = auth.user_id

  try {
    const body = await c.req.json<UpdatePreferencesInput>()
    const validationError = validatePreferences(body)
    if (validationError) return badRequest(validationError)

    const updates: string[] = []
    const values: Array<string | number | null> = []

    if (body.theme !== undefined) { updates.push('theme = ?'); values.push(body.theme) }
    if (body.page_size !== undefined) { updates.push('page_size = ?'); values.push(body.page_size) }
    if (body.view_mode !== undefined) { updates.push('view_mode = ?'); values.push(body.view_mode) }
    if (body.density !== undefined) { updates.push('density = ?'); values.push(body.density) }
    if (body.tag_layout !== undefined) { updates.push('tag_layout = ?'); values.push(body.tag_layout) }
    if (body.sort_by !== undefined) { updates.push('sort_by = ?'); values.push(body.sort_by) }
    if (body.bookmark_nav_mode !== undefined) { updates.push('bookmark_nav_mode = ?'); values.push(body.bookmark_nav_mode) }
    if (body.bookmark_aux_panel !== undefined) { updates.push('bookmark_aux_panel = ?'); values.push(body.bookmark_aux_panel) }
    if (body.search_auto_clear_seconds !== undefined) { updates.push('search_auto_clear_seconds = ?'); values.push(body.search_auto_clear_seconds) }
    if (body.tag_selection_auto_clear_seconds !== undefined) { updates.push('tag_selection_auto_clear_seconds = ?'); values.push(body.tag_selection_auto_clear_seconds) }
    if (body.enable_search_auto_clear !== undefined) { updates.push('enable_search_auto_clear = ?'); values.push(body.enable_search_auto_clear ? 1 : 0) }
    if (body.enable_tag_selection_auto_clear !== undefined) { updates.push('enable_tag_selection_auto_clear = ?'); values.push(body.enable_tag_selection_auto_clear ? 1 : 0) }
    if (body.default_bookmark_icon !== undefined) { updates.push('default_bookmark_icon = ?'); values.push(body.default_bookmark_icon) }

    if (updates.length === 0) return badRequest('No valid fields to update')

    const now = new Date().toISOString()
    updates.push('updated_at = ?')
    values.push(now, userId)

    // Upsert: ensure the row exists, then patch. (user_preferences.user_id is PK.)
    await c.env.DB.batch([
      c.env.DB
        .prepare('INSERT INTO user_preferences (user_id) VALUES (?) ON CONFLICT(user_id) DO NOTHING')
        .bind(userId),
      c.env.DB
        .prepare(`UPDATE user_preferences SET ${updates.join(', ')} WHERE user_id = ?`)
        .bind(...values),
    ])

    // Preferences are a synced entity: without a change record the extension's
    // incremental pull never sees web-side preference updates (next bootstrap,
    // up to 24h later, would be the only convergence path).
    await emitSyncChange(c.env.DB, userId, 'preference', 'preferences', 'upsert')

    const row = await c.env.DB
      .prepare('SELECT * FROM user_preferences WHERE user_id = ?')
      .bind(userId)
      .first<UserPreferences>()
    if (!row) return internalError('Failed to load preferences after update')
    return success({ preferences: mapPreferences(row) })
  } catch (error) {
    console.error('Update preferences error:', error)
    return internalError('Failed to update preferences')
  }
}

preferencesRoutes.get('/', requireDataAuth('user.preferences.read'), getPreferencesHandler)
preferencesRoutes.patch('/', requireDataAuth('user.preferences.write'), updatePreferencesHandler)
