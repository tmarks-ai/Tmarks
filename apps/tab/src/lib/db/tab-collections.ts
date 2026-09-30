import { db, type LocalTabGroup, type LocalTabGroupItem } from './index'
import { enqueueSyncOperation } from './queue'
import { logOperation } from './operation-logs'
import type { EntityId } from '@tmarks/contracts'

/** 标签组条目同步字段集合(RC-M 统一:采集与手动两处复用同一常量)。 */
export const ITEM_DIRTY_FIELDS = ['group_id', 'title', 'url', 'favicon', 'position', 'is_pinned', 'is_todo', 'is_archived']

export async function createTabGroupFolderLocal(name: string, parentId: EntityId | null): Promise<LocalTabGroup> {
  const now = new Date().toISOString()
  const id = crypto.randomUUID() as EntityId
  const group: LocalTabGroup = {
    id, title: name, color: null, tags: [], parent_id: parentId,
    is_folder: true, position: 0, item_count: 0,
    created_at: now, updated_at: now, deleted_at: null,
    base_revision: null, dirty_fields: ['title', 'parent_id', 'is_folder'], pending_op: 'upsert',
  }
  await db.tabGroups.put(group)
  await enqueueSyncOperation({ entityType: 'tab_group', entityId: id, operation: 'upsert', baseRevision: null, payload: groupPayload(group) })
  await logOperation({ entity_type: 'tab_group', entity_id: id, operation: 'upsert' })
  return group
}

export function groupPayload(g: LocalTabGroup): Record<string, unknown> {
  return { title: g.title, parent_id: g.parent_id, is_folder: g.is_folder, position: g.position, color: g.color, tags: g.tags }
}

export function itemPayload(it: LocalTabGroupItem): Record<string, unknown> {
  return { group_id: it.group_id, title: it.title, url: it.url, favicon: it.favicon, position: it.position, is_pinned: it.is_pinned, is_todo: it.is_todo, is_archived: it.is_archived }
}
