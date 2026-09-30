import type { SyncCursor } from '@tmarks/contracts'
import { encodeCursor } from './sync-utils'

export async function getLatestSyncCursor(db: D1Database, userId: string): Promise<SyncCursor> {
  const row = await db
    .prepare('SELECT COALESCE(MAX(id), 0) as id FROM sync_changes WHERE user_id = ?')
    .bind(userId)
    .first<{ id: number }>()
  return encodeCursor(row?.id ?? 0)
}
