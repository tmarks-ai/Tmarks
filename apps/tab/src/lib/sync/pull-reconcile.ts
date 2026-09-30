import type { EntityId } from '@tmarks/contracts'
import { db } from '../db'

/**
 * Bootstrap reconciliation.
 *
 * A full snapshot is the only signal for entities the server removed without
 * leaving a tombstone, so anything local that the snapshot does not mention is
 * assumed gone. Entities with unpushed local edits (`dirty_fields`) are always
 * kept — losing those would destroy work the user has not synced yet.
 *
 * Pruning must run only after *every* bootstrap page has arrived; running it
 * per page would delete entities that simply had not been sent yet.
 */
export interface BootstrapServerIds {
  tab_groups: Set<string>
  tab_group_items: Set<string>
  bookmarks: Set<string>
  bookmark_folders: Set<string>
  tags: Set<string>
}

export function createBootstrapServerIds(): BootstrapServerIds {
  return {
    tab_groups: new Set<string>(),
    tab_group_items: new Set<string>(),
    bookmarks: new Set<string>(),
    bookmark_folders: new Set<string>(),
    tags: new Set<string>(),
  }
}

/** 删除组及其条目;保留有本地未推送改动的条目。 */
export async function removeGroupAndItems(groupId: EntityId): Promise<void> {
  await db.transaction('rw', [db.tabGroups, db.tabGroupItems], async () => {
    await db.tabGroups.delete(groupId)
    // 仅硬删无本地待 push 改动的条目,避免远程组删除一并抹掉本地脏条目。
    const items = await db.tabGroupItems.where('group_id').equals(groupId).toArray()
    const stale = items.filter((it) => it.dirty_fields.length === 0)
    if (stale.length > 0) await db.tabGroupItems.bulkDelete(stale.map((it) => it.id))
  })
}

export async function reconcileBootstrap(serverIds: BootstrapServerIds): Promise<void> {
  for (const row of await db.tabGroups.toArray()) {
    if (row.dirty_fields.length > 0 || serverIds.tab_groups.has(row.id)) continue
    await removeGroupAndItems(row.id)
  }
  for (const row of await db.tabGroupItems.toArray()) {
    if (row.dirty_fields.length > 0 || serverIds.tab_group_items.has(row.id)) continue
    await db.tabGroupItems.delete(row.id)
  }
  for (const row of await db.bookmarks.toArray()) {
    if (row.dirty_fields.length > 0 || serverIds.bookmarks.has(row.id)) continue
    await db.bookmarks.delete(row.id)
  }
  for (const row of await db.folders.toArray()) {
    if (row.dirty_fields.length > 0 || serverIds.bookmark_folders.has(row.id)) continue
    await db.folders.delete(row.id)
  }
  for (const row of await db.tags.toArray()) {
    if (row.dirty_fields.length > 0 || serverIds.tags.has(row.id)) continue
    await db.tags.delete(row.id)
  }
  await recomputeItemCounts()
}

async function recomputeItemCounts(): Promise<void> {
  for (const group of await db.tabGroups.toArray()) {
    const count = await db.tabGroupItems.where('group_id').equals(group.id).count()
    if (group.item_count !== count) await db.tabGroups.update(group.id, { item_count: count })
  }
}
