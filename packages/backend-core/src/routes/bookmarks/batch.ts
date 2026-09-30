import type { Context } from 'hono'
import type { AppEnv } from '../../lib/env'
import { badRequest, internalError, success } from '../../lib/response'
import {
  handleBatchCreate,
  requireBookmarkBatchCreatePermissions,
  type BatchCreateBookmarkInput,
} from '../../lib/bookmarks'

type BatchSource = 'api' | 'api-tab-batch'

/**
 * Shared batch-create route glue for POST /bookmarks and the new batch-import
 * endpoint: validate the array, enforce fine-grained API-key permissions, run
 * the domain batch and record an audit row
 * on success.
 */
export async function runBatchCreate(
  c: Context<AppEnv>,
  userId: string,
  bookmarks: BatchCreateBookmarkInput[] | undefined,
  source: BatchSource
): Promise<Response> {
  if (!bookmarks || !Array.isArray(bookmarks) || bookmarks.length === 0) {
    return badRequest('bookmarks array is required and cannot be empty')
  }

  if (bookmarks.length > 100) {
    return badRequest('Cannot create more than 100 bookmarks at once')
  }

  const auth = c.get('auth')
  if (!auth) return internalError('User not found')

  const permissionError = requireBookmarkBatchCreatePermissions(auth, bookmarks)
  if (permissionError) return permissionError

  const startedAt = Date.now()
  const now = new Date().toISOString()
  const result = await handleBatchCreate(c.env.DB, userId, bookmarks, now)

  await recordBatchCreateAudit(c.env.DB, userId, result, source, Date.now() - startedAt)

  return success(result)
}

async function recordBatchCreateAudit(
  db: D1Database,
  userId: string,
  result: BatchCreateResult,
  source: BatchSource,
  durationMs: number
): Promise<void> {
  try {
    await db
      .prepare(
        `INSERT INTO audit_logs (user_id, event_type, payload, created_at)
         VALUES (?, 'batch_create_bookmarks', ?, ?)`
      )
      .bind(
        userId,
        JSON.stringify({
          import_batch_id: result.import_batch_id,
          source,
          total: result.total,
          success: result.success,
          failed: result.failed,
          skipped: result.skipped,
          duration_ms: durationMs,
        }),
        new Date().toISOString()
      )
      .run()
  } catch (error) {
    console.error('[Batch] Failed to write audit log:', error)
  }
}

type BatchCreateResult = Awaited<ReturnType<typeof handleBatchCreate>>
