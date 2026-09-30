import { chunkForD1In } from '../d1-chunk'

interface BatchDeleteTabGroupItemsRequest {
  action: 'delete'
  item_ids: string[]
}

interface BatchUpdateTabGroupItemsRequest {
  action: 'update'
  item_ids: string[]
  data: {
    is_pinned?: boolean
    is_todo?: boolean
    is_archived?: boolean
  }
}

export type BatchTabGroupItemsRequest =
  | BatchDeleteTabGroupItemsRequest
  | BatchUpdateTabGroupItemsRequest

export type BatchTabGroupItemsResult =
  | { ok: true; data: { message: string; deleted_count: number; affected_group_ids: string[] } }
  | { ok: true; data: { message: string; updated_count: number; affected_group_ids: string[] } }
  | { ok: false; message: string; code?: 'RESOURCE_LOCKED' }

interface OwnedItemRow {
  id: string
  group_id: string
  position: number
}

const MAX_BATCH_SIZE = 100

export async function handleBatchTabGroupItems(
  db: D1Database,
  userId: string,
  body: BatchTabGroupItemsRequest
): Promise<BatchTabGroupItemsResult> {
  if (!body.action || !Array.isArray(body.item_ids) || body.item_ids.length === 0) {
    return { ok: false, message: 'action and non-empty item_ids array are required' }
  }

  if (body.item_ids.length > MAX_BATCH_SIZE) {
    return { ok: false, message: `Maximum ${MAX_BATCH_SIZE} items per batch` }
  }

  const itemIds = [...new Set(body.item_ids.filter((id) => typeof id === 'string' && id.trim()))]
  if (itemIds.length === 0) {
    return { ok: false, message: 'No valid item IDs provided' }
  }

  // Locked groups/items are rejected up front with the same semantics as the
  // single-item routes (403 RESOURCE_LOCKED), instead of silently dropping
  // the locked ids from the batch.
  const lockState = await findLockedItems(db, userId, itemIds)
  if (lockState.group) {
    return { ok: false, message: 'Tab group is locked', code: 'RESOURCE_LOCKED' }
  }
  if (lockState.item) {
    return { ok: false, message: 'Tab group item is locked', code: 'RESOURCE_LOCKED' }
  }

  const validItems = await getOwnedItems(db, userId, itemIds)
  if (validItems.length === 0) {
    return { ok: false, message: 'No valid items found' }
  }

  if (body.action === 'delete') {
    return deleteItems(db, validItems)
  }

  if (body.action === 'update') {
    return updateItems(db, validItems, body.data)
  }

  return { ok: false, message: 'Invalid action. Supported: delete, update' }
}

async function getOwnedItems(
  db: D1Database,
  userId: string,
  itemIds: string[]
): Promise<OwnedItemRow[]> {
  // D1 caps bound parameters at 100/query: the batch max of 100 ids + user_id
  // used to 500 at the route's own advertised maximum. Chunk the read.
  const rows: OwnedItemRow[] = []
  for (const chunk of chunkForD1In(itemIds, 1)) {
    const placeholders = chunk.map(() => '?').join(',')
    const { results } = await db.prepare(
      `SELECT tgi.id, tgi.group_id, tgi.position
       FROM tab_group_items tgi
       JOIN tab_groups tg ON tgi.group_id = tg.id
       WHERE tgi.id IN (${placeholders})
         AND tg.user_id = ?
         AND (tg.is_deleted IS NULL OR tg.is_deleted = 0)
         AND COALESCE(tg.is_locked, 0) = 0
         AND COALESCE(tgi.is_locked, 0) = 0`
    )
      .bind(...chunk, userId)
      .all<OwnedItemRow>()
    rows.push(...(results || []))
  }
  return rows
}

/** Report whether any requested item sits in a locked group or is itself locked. */
async function findLockedItems(
  db: D1Database,
  userId: string,
  itemIds: string[]
): Promise<{ group: boolean; item: boolean }> {
  let group = false
  let item = false
  for (const chunk of chunkForD1In(itemIds, 1)) {
    const placeholders = chunk.map(() => '?').join(',')
    const { results } = await db.prepare(
      `SELECT tg.is_locked as group_is_locked, tgi.is_locked as item_is_locked
       FROM tab_group_items tgi
       JOIN tab_groups tg ON tgi.group_id = tg.id
       WHERE tgi.id IN (${placeholders}) AND tg.user_id = ?`
    )
      .bind(...chunk, userId)
      .all<{ group_is_locked?: number; item_is_locked?: number }>()
    for (const row of results || []) {
      if (row.group_is_locked) group = true
      if (row.item_is_locked) item = true
    }
  }
  return { group, item }
}

async function deleteItems(
  db: D1Database,
  validItems: OwnedItemRow[]
): Promise<BatchTabGroupItemsResult> {
  const validIds = validItems.map((item) => item.id)
  const statements: D1PreparedStatement[] = []
  // Chunked: D1 caps bound parameters at 100/query.
  for (const idChunk of chunkForD1In(validIds, 0)) {
    const deletePlaceholders = idChunk.map(() => '?').join(',')
    statements.push(
      db.prepare(`DELETE FROM tab_group_items WHERE id IN (${deletePlaceholders})`).bind(...idChunk)
    )
  }

  for (const groupId of [...new Set(validItems.map((item) => item.group_id))]) {
    statements.push(
      db.prepare(
        `UPDATE tab_group_items SET position = (
          SELECT COUNT(*) FROM tab_group_items tgi2
          WHERE tgi2.group_id = tab_group_items.group_id
            AND tgi2.position < tab_group_items.position
            AND tgi2.id != tab_group_items.id
        ) WHERE group_id = ?`
      ).bind(groupId)
    )
  }

  await db.batch(statements)
  return {
    ok: true,
    data: {
      message: 'Items deleted',
      deleted_count: validIds.length,
      affected_group_ids: [...new Set(validItems.map((item) => item.group_id))],
    },
  }
}

async function updateItems(
  db: D1Database,
  validItems: OwnedItemRow[],
  data: BatchUpdateTabGroupItemsRequest['data']
): Promise<BatchTabGroupItemsResult> {
  if (!data || typeof data !== 'object') {
    return { ok: false, message: 'data object is required for update action' }
  }

  const updates: string[] = []
  const updateParams: Array<string | number> = []

  if (data.is_pinned !== undefined) {
    updates.push('is_pinned = ?')
    updateParams.push(data.is_pinned ? 1 : 0)
  }
  if (data.is_todo !== undefined) {
    updates.push('is_todo = ?')
    updateParams.push(data.is_todo ? 1 : 0)
  }
  if (data.is_archived !== undefined) {
    updates.push('is_archived = ?')
    updateParams.push(data.is_archived ? 1 : 0)
  }
  if (updates.length === 0) {
    return { ok: false, message: 'No valid fields to update' }
  }

  const validIds = validItems.map((item) => item.id)
  const statements: D1PreparedStatement[] = []
  // Chunked: up to 3 update-field params + the id list per statement.
  for (const idChunk of chunkForD1In(validIds, updateParams.length)) {
    const updatePlaceholders = idChunk.map(() => '?').join(',')
    statements.push(
      db.prepare(`UPDATE tab_group_items SET ${updates.join(', ')} WHERE id IN (${updatePlaceholders})`)
        .bind(...updateParams, ...idChunk)
    )
  }
  await db.batch(statements)

  return {
    ok: true,
    data: {
      message: 'Items updated',
      updated_count: validIds.length,
      affected_group_ids: [...new Set(validItems.map((item) => item.group_id))],
    },
  }
}
