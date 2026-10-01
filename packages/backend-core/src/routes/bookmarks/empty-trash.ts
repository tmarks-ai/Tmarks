import type { Context } from 'hono'
import type { EmptyTrashResponse } from '@tmarks/contracts'
import type { AppEnv } from '../../lib/env'
import { emptyTrash } from '../../lib/bookmarks'
import { purgeSnapshotObjects } from '../../lib/bookmarks/snapshot-r2'
import { getSafeWaitUntil } from '../../lib/safe-wait-until'
import { internalError, success } from '../../lib/response'

/** POST /trash/empty — permanently delete every trashed bookmark for the current user. */
export async function emptyTrashHandler(c: Context<AppEnv>): Promise<Response> {
  const auth = c.get('auth')
  if (!auth) return internalError('User not found')

  const result = await emptyTrash(c.env.DB, auth.user_id)
  purgeSnapshotObjects(c.env, result.orphanedStorageKeys, getSafeWaitUntil(c), c.req.url)
  if (!result.success) return internalError(result.error || 'Failed to empty trash')

  const response: EmptyTrashResponse = {
    message: 'Trash emptied',
    count: result.count ?? 0,
  }
  return success(response)
}
