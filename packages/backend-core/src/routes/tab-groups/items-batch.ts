import type { Context } from 'hono'
import type { AppEnv } from '../../lib/env'
import { badRequest, forbidden, internalError, success } from '../../lib/response'
import { emitSyncChanges } from '../../lib/sync/sync-emit'
import {
  handleBatchTabGroupItems,
  type BatchTabGroupItemsRequest,
} from '../../lib/tab-groups'

/** POST /items/batch — batch delete or update tab-group items by item id. */
export async function itemsBatchHandler(c: Context<AppEnv>): Promise<Response> {
  const auth = c.get('auth')
  if (!auth) return internalError('User not found')
  const userId = auth.user_id

  try {
    const body = await c.req.json<BatchTabGroupItemsRequest>()
    const result = await handleBatchTabGroupItems(c.env.DB, userId, body)
    if (result.ok) {
      // Mirrors the single-item routes: group contents changed, so the owning
      // groups need a sync change or the extension misses the batch mutation.
      await emitSyncChanges(c.env.DB, userId, 'tab_group', result.data.affected_group_ids, 'upsert')
      return success(result.data)
    }
    if (result.code === 'RESOURCE_LOCKED') return forbidden(result.message, result.code)
    return badRequest(result.message)
  } catch (error) {
    console.error('Batch tab group items error:', error)
    return internalError('Failed to process batch operation')
  }
}
