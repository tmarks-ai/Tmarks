import type { Context } from 'hono'
import type { AppEnv } from '../../lib/env'
import { internalError } from '../../lib/response'
import { runBatchCreate } from './batch'
import type { BatchCreateBookmarkInput } from '../../lib/bookmarks'

interface BatchCreateRequest {
  bookmarks: BatchCreateBookmarkInput[]
}

/** POST /bookmarks/batch — create up to 100 bookmarks in a single request. */
export async function batchCreateHandler(c: Context<AppEnv>): Promise<Response> {
  const auth = c.get('auth')
  if (!auth) return internalError('User not found')
  const userId = auth.user_id

  try {
    const body = await c.req.json<BatchCreateRequest>()
    return runBatchCreate(c, userId, body.bookmarks, 'api-tab-batch')
  } catch (error) {
    console.error('Batch create bookmarks error:', error)
    return internalError('Failed to batch create bookmarks')
  }
}
