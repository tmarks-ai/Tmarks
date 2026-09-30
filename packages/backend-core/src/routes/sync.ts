import { Hono } from 'hono'
import type { Context } from 'hono'
import type { AppEnv } from '../lib/env'
import { badRequest, internalError, success } from '../lib/response'
import { requireDataAuth } from '../middleware/data-auth'
import {
  bootstrapSyncChanges,
  getLatestSyncCursor,
  listSyncChanges,
  pushSyncOperations,
} from '../lib/sync'
import type { SyncPushRequest, SyncStateDTO } from '@tmarks/contracts'
import { syncSummaryHandler } from './sync/summary'

const SYNC_READ_PERMISSIONS = [
  'user.read',
  'bookmarks.read',
  'bookmark_folders.read',
  'tags.read',
  'tab_groups.read',
  'user.preferences.read',
] as const

const SYNC_WRITE_PERMISSIONS = [
  ...SYNC_READ_PERMISSIONS,
  'user.preferences.write',
  'bookmarks.create',
  'bookmarks.update',
  'bookmarks.delete',
  'bookmark_folders.create',
  'bookmark_folders.update',
  'bookmark_folders.delete',
  'tags.create',
  'tags.update',
  'tags.delete',
  'tags.assign',
  'tab_groups.create',
  'tab_groups.update',
  'tab_groups.delete',
] as const

async function syncBootstrapHandler(c: Context<AppEnv>): Promise<Response> {
  const auth = c.get('auth')
  if (!auth) return internalError('User not found')
  try {
    const url = new URL(c.req.url)
    const bootstrap = await bootstrapSyncChanges(c.env.DB, auth.user_id, {
      pageCursor: url.searchParams.get('page_cursor'),
      pageSize: Number(url.searchParams.get('page_size')) || undefined,
    })
    return success({
      cursor: bootstrap.cursor,
      server_time: new Date().toISOString(),
      has_more: bootstrap.has_more,
      page_cursor: bootstrap.page_cursor,
      entities: {
        bookmarks: bootstrap.bookmarks,
        bookmark_folders: bootstrap.bookmark_folders,
        tags: bootstrap.tags,
        tab_groups: bootstrap.tab_groups,
        tab_group_items: bootstrap.tab_group_items,
        preferences: bootstrap.preferences,
      },
    })
  } catch (error) {
    console.error('Extension sync bootstrap error:', error)
    return internalError('Failed to bootstrap sync')
  }
}

async function syncChangesHandler(c: Context<AppEnv>): Promise<Response> {
  const auth = c.get('auth')
  if (!auth) return internalError('User not found')
  const url = new URL(c.req.url)
  const cursor = url.searchParams.get('cursor')
  const pageSize = Math.min(parseInt(url.searchParams.get('page_size') || '100', 10) || 100, 200)
  try {
    return success(await listSyncChanges(c.env.DB, auth.user_id, cursor, pageSize))
  } catch (error) {
    console.error('Extension sync changes error:', error)
    return internalError('Failed to load sync changes')
  }
}

async function syncPushHandler(c: Context<AppEnv>): Promise<Response> {
  const auth = c.get('auth')
  if (!auth) return internalError('User not found')
  try {
    const body = await c.req.json<SyncPushRequest>()
    if (!body || typeof body.device_id !== 'string' || body.device_id.trim() === '') {
      return badRequest({ code: 'VALIDATION_FAILED', message: 'device_id is required.' })
    }
    if (!Array.isArray(body.operations)) {
      return badRequest({ code: 'VALIDATION_FAILED', message: 'operations must be an array.' })
    }
    const configuredBatchSize = Number(c.env.SYNC_MAX_BATCH_SIZE)
    const maxBatchSize = Number.isFinite(configuredBatchSize) && configuredBatchSize > 0
      ? Math.min(Math.floor(configuredBatchSize), 1000)
      : 100
    if (body.operations.length > maxBatchSize) {
      return badRequest({
        code: 'QUOTA_EXCEEDED',
        message: `Maximum ${maxBatchSize} sync operations are allowed per request.`,
        details: { limit: maxBatchSize, received: body.operations.length },
      })
    }
    const result = await pushSyncOperations(c.env.DB, auth.user_id, body.device_id, body.operations)
    return success(result)
  } catch (error) {
    console.error('Extension sync push error:', error)
    return internalError('Failed to push sync operations')
  }
}

async function syncStatusHandler(c: Context<AppEnv>): Promise<Response> {
  const auth = c.get('auth')
  if (!auth) return internalError('User not found')
  try {
    const data: SyncStateDTO = {
      cursor: await getLatestSyncCursor(c.env.DB, auth.user_id),
      last_successful_sync_at: null,
      mode: 'cloud_sync',
    }
    return success(data)
  } catch (error) {
    console.error('Extension sync status error:', error)
    return internalError('Failed to load sync status')
  }
}

/**
 * Web/Tab sync routes mounted under `/api/v1/sync`.
 * Bootstrap returns the full entity state, changes returns the incremental
 * log past a cursor, push applies a batch of operations, and status returns the cursor.
 */
export const syncRoutes = new Hono<AppEnv>()

syncRoutes.use('/bootstrap', requireDataAuth(SYNC_READ_PERMISSIONS))
syncRoutes.get('/bootstrap', syncBootstrapHandler)
syncRoutes.use('/changes', requireDataAuth(SYNC_READ_PERMISSIONS))
syncRoutes.get('/changes', syncChangesHandler)
syncRoutes.use('/push', requireDataAuth(SYNC_WRITE_PERMISSIONS))
syncRoutes.post('/push', syncPushHandler)
syncRoutes.use('/status', requireDataAuth(SYNC_READ_PERMISSIONS))
syncRoutes.get('/status', syncStatusHandler)
syncRoutes.use('/summary', requireDataAuth(SYNC_READ_PERMISSIONS))
syncRoutes.get('/summary', syncSummaryHandler)
