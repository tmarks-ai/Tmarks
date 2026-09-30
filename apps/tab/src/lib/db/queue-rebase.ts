import { db } from './index'
import type { SyncEntityType } from './queue'
import type { EntityId, Revision } from '@tmarks/contracts'

/** 仅重置 base_revision(保留脏标记):在途编辑的 rebase。folders 用 get→put,
 * 其 update/modify 的 KeyPaths 推导对其自引用 children 类型循环展开。 */
export async function rebaseEntityRevision(entityType: SyncEntityType, entityId: EntityId, revision: Revision): Promise<void> {
  if (entityType === 'bookmark_folder') {
    const folder = await db.folders.get(entityId)
    if (folder) await db.folders.put({ ...folder, base_revision: revision })
    return
  }
  const table = entityType === 'tab_group' ? db.tabGroups
    : entityType === 'tab_group_item' ? db.tabGroupItems
    : entityType === 'bookmark' ? db.bookmarks
    : db.tags
  await table.update(entityId, { base_revision: revision })
}
