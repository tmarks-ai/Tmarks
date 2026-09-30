import type {
  EntityId,
  Revision,
  SyncBootstrapResponse,
  SyncChange,
  SyncChangesResponse,
  SyncCursor,
} from '@tmarks/contracts'
import { apiClient, unwrapData } from '../api/client'
import { db, type LocalBookmark, type LocalFolder, type LocalTabGroup, type LocalTabGroupItem, type LocalTag } from '../db'
import { getSyncState, saveSyncState } from '../db/sync-state'
import { normalizeBookmarkRow, normalizeFolderRow, normalizeTabGroupItemRow, normalizeTabGroupRow, normalizeTagRow } from './normalize'
import { isForbiddenError } from './forbidden'
import { createBootstrapServerIds, reconcileBootstrap, removeGroupAndItems } from './pull-reconcile'

const PAGE_SIZE = 100
/** 分页拉取上限(RC-E):防服务端 has_more 误报或游标故障导致无限分页。 */
const MAX_PULL_PAGES = 100
/** bootstrap 分页上限:每页 2000 实体,足以覆盖极大账号,同时防止游标故障导致死循环。 */
const MAX_BOOTSTRAP_PAGES = 200

export interface PullResult {
  applied: number
  forbidden: boolean
  bootstrapped: boolean
}

/** 应用单个变更(组/条目);跳过本地 dirty 实体(保留待 push);非组类实体跳过(仅推进游标)。
 *  导出供测试直接驱动:拉取链路的正确性全部落在这里。 */
export async function applyChange(change: SyncChange): Promise<void> {
  if (change.entity_type === 'tab_group') return applyTabGroupChange(change)
  if (change.entity_type === 'tab_group_item') return applyTabGroupItemChange(change)
  if (change.entity_type === 'bookmark') return applyBookmarkChange(change)
  if (change.entity_type === 'bookmark_folder') return applyFolderChange(change)
  if (change.entity_type === 'tag') return applyTagChange(change)
  // preference:扩展端不落库,仅推进游标。
}

async function applyTabGroupChange(change: SyncChange): Promise<void> {
  const row = (change.payload ?? {}) as Record<string, unknown>
  const { dto, isDeleted } = normalizeTabGroupRow(row)
  const tabs = Array.isArray(row.tabs) ? (row.tabs as Record<string, unknown>[]) : null

  if (isDeleted || change.operation === 'delete') {
    const local = await db.tabGroups.get(change.entity_id)
    if (local && local.dirty_fields.length === 0) await removeGroupAndItems(change.entity_id)
    return
  }

  const local = await db.tabGroups.get(change.entity_id)
  if (local && local.dirty_fields.length > 0) return // 保留本地待 push,避免覆盖未上报改动

  // tabs 为 null(payload 未携带该键)才表示"无信息";空数组是权威的"这个组现在没有
  // 条目",此前按无信息处理,导致在别处删掉组内最后一个条目后,本地会一直留着它,
  // 直到 24 小时全量 bootstrap 才纠正。
  const authoritativeTabs = tabs !== null

  const dirtyItems = authoritativeTabs
    ? new Map(
        (await db.tabGroupItems.where('group_id').equals(change.entity_id).toArray())
          .filter((item) => item.dirty_fields.length > 0)
          .map((item) => [item.id, item]),
      )
    : new Map<string, LocalTabGroupItem>()

  let items: LocalTabGroupItem[] = []
  if (authoritativeTabs) {
    await db.tabGroupItems.where('group_id').equals(change.entity_id).delete()
    items = tabs.map((t, i) => {
      const itemDto = normalizeTabGroupItemRow(t).dto
      const localDirty = dirtyItems.get(itemDto.id)
      if (localDirty) return localDirty
      return {
        ...itemDto,
        group_id: (itemDto.group_id || change.entity_id) as EntityId,
        position: itemDto.position ?? i,
        base_revision: change.revision as Revision,
        dirty_fields: [],
        pending_op: null,
      }
    })
    // 本地有待 push 改动但服务端已无此条目 → 保留,等 push 决出胜负。
    for (const localDirty of dirtyItems.values()) {
      if (!items.some((item) => item.id === localDirty.id)) items.push(localDirty)
    }
    if (items.length) await db.tabGroupItems.bulkPut(items)
  }

  const item_count = authoritativeTabs ? items.length : (local?.item_count ?? 0)
  const group: LocalTabGroup = {
    ...dto,
    item_count,
    base_revision: change.revision as Revision,
    dirty_fields: [],
    pending_op: null,
  }
  await db.tabGroups.put(group)
}

async function applyTabGroupItemChange(change: SyncChange): Promise<void> {
  const row = (change.payload ?? {}) as Record<string, unknown>
  const { dto, isDeleted } = normalizeTabGroupItemRow(row)

  if (isDeleted || change.operation === 'delete') {
    const local = await db.tabGroupItems.get(change.entity_id)
    if (local && local.dirty_fields.length === 0) await db.tabGroupItems.delete(change.entity_id)
    return
  }

  const local = await db.tabGroupItems.get(change.entity_id)
  if (local && local.dirty_fields.length > 0) return

  const item: LocalTabGroupItem = {
    ...dto,
    base_revision: change.revision as Revision,
    dirty_fields: [],
    pending_op: null,
  }
  await db.tabGroupItems.put(item)
}

async function applyBookmarkChange(change: SyncChange): Promise<void> {
  const row = (change.payload ?? {}) as Record<string, unknown>
  const { dto, isDeleted } = normalizeBookmarkRow(row)
  if (isDeleted || change.operation === 'delete') {
    const local = await db.bookmarks.get(change.entity_id)
    if (local && local.dirty_fields.length === 0) await db.bookmarks.delete(change.entity_id)
    return
  }
  const local = await db.bookmarks.get(change.entity_id)
  if (local && local.dirty_fields.length > 0) return // 保留本地待 push
  const bookmark: LocalBookmark = { ...dto, base_revision: change.revision as Revision, dirty_fields: [], pending_op: null }
  await db.bookmarks.put(bookmark)
}

async function applyFolderChange(change: SyncChange): Promise<void> {
  const row = (change.payload ?? {}) as Record<string, unknown>
  const { dto, isDeleted } = normalizeFolderRow(row)
  // folder delete:对齐 bookmark 硬删本地副本(dirty_fields 非空跳过保留待 push)。
  if (isDeleted || change.operation === 'delete') {
    const local = await db.folders.get(change.entity_id)
    if (local && local.dirty_fields.length === 0) await db.folders.delete(change.entity_id)
    return
  }
  const local = await db.folders.get(change.entity_id)
  if (local && local.dirty_fields.length > 0) return
  const folder: LocalFolder = { ...dto, base_revision: change.revision as Revision, dirty_fields: [], pending_op: null }
  await db.folders.put(folder)
}

async function applyTagChange(change: SyncChange): Promise<void> {
  const row = (change.payload ?? {}) as Record<string, unknown>
  const { dto, isDeleted } = normalizeTagRow(row)
  // tag 无 deleted_at 字段,delete 硬删(对齐 tab_group_item)。
  if (isDeleted || change.operation === 'delete') {
    const local = await db.tags.get(change.entity_id)
    if (local && local.dirty_fields.length === 0) await db.tags.delete(change.entity_id)
    return
  }
  const local = await db.tags.get(change.entity_id)
  if (local && local.dirty_fields.length > 0) return
  const tag: LocalTag = { ...dto, base_revision: change.revision as Revision, dirty_fields: [], pending_op: null }
  await db.tags.put(tag)
}


/** 增量拉取(自游标),分页直到 has_more=false;捕获其他扩展 push 与服务器回声。 */
export async function pullChanges(): Promise<PullResult> {
  let state = await getSyncState()
  let cursor: SyncCursor | null = state.cursor
  let applied = 0
  let complete = false
  for (let page = 0; page < MAX_PULL_PAGES; page++) {
    const res = await fetchChangesPage(cursor)
    if (res.kind === 'forbidden') return { applied, forbidden: true, bootstrapped: false }
    for (const change of res.value.changes) {
      await applyChange(change)
      applied++
    }
    cursor = res.value.cursor
    // Persist each completed page so a later page failure is retryable from the
    // last known cursor. Do not persist last_sync_at until pagination completes.
    await saveSyncState({ cursor })
    if (!res.value.has_more) {
      complete = true
      break
    }
  }
  if (!complete) throw new Error(`Incremental sync exceeded ${MAX_PULL_PAGES} pages`)
  await saveSyncState({ last_sync_at: new Date().toISOString() })
  return { applied, forbidden: false, bootstrapped: false }
}

type PageResult = { kind: 'ok'; value: SyncChangesResponse } | { kind: 'forbidden' }

async function fetchChangesPage(cursor: SyncCursor | null): Promise<PageResult> {
  try {
    const path = `/api/v1/sync/changes?page_size=${PAGE_SIZE}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`
    const value = await unwrapData(await apiClient.get<SyncChangesResponse>(path), 'GET /api/v1/sync/changes')
    return { kind: 'ok', value }
  } catch (e) {
    if (isForbiddenError(e)) return { kind: 'forbidden' }
    throw e
  }
}

/** 全量 bootstrap(游标为空或显式重同步):分页拉取全部实体 + 对账删除 + 重算 item_count。 */
export async function bootstrapSync(): Promise<PullResult> {
  const serverIds = createBootstrapServerIds()
  let applied = 0
  let cursor: SyncCursor | null = null
  let pageCursor: string | null = null

  // 分页应用,但对账(prune)必须等所有页到齐后再做:提前对账会把「尚未收到的
  // 实体」误判为服务端已删除而清掉本地副本。
  for (let page = 0; page < MAX_BOOTSTRAP_PAGES; page++) {
    let boot: SyncBootstrapResponse
    try {
      const query = pageCursor ? `?page_cursor=${encodeURIComponent(pageCursor)}` : ''
      boot = await unwrapData(
        await apiClient.get<SyncBootstrapResponse>(`/api/v1/sync/bootstrap${query}`),
        'GET /api/v1/sync/bootstrap',
      )
    } catch (e) {
      if (isForbiddenError(e)) return { applied: 0, forbidden: true, bootstrapped: false }
      throw e
    }

    // 服务端在首页之前就取好同步游标并随分页令牌透传,各页一致。
    cursor = boot.cursor

    for (const change of boot.entities.tab_groups) serverIds.tab_groups.add(change.entity_id)
    for (const change of boot.entities.tab_group_items) serverIds.tab_group_items.add(change.entity_id)
    for (const change of boot.entities.bookmarks) serverIds.bookmarks.add(change.entity_id)
    for (const change of boot.entities.bookmark_folders) serverIds.bookmark_folders.add(change.entity_id)
    for (const change of boot.entities.tags) serverIds.tags.add(change.entity_id)

    await db.transaction('rw', [db.tabGroups, db.tabGroupItems, db.bookmarks, db.folders, db.tags], async () => {
      // 父先于子:服务端按同样顺序分页,书签不会早于它所属的目录到达。
      for (const change of boot.entities.bookmark_folders) await applyFolderChange(change)
      for (const change of boot.entities.tags) await applyTagChange(change)
      for (const change of boot.entities.bookmarks) await applyBookmarkChange(change)
      for (const change of boot.entities.tab_groups) await applyTabGroupChange(change)
      for (const change of boot.entities.tab_group_items) await applyTabGroupItemChange(change)
    })

    applied +=
      boot.entities.tab_groups.length +
      boot.entities.tab_group_items.length +
      boot.entities.bookmarks.length +
      boot.entities.bookmark_folders.length +
      boot.entities.tags.length

    // A missing has_more is the legacy complete response. Otherwise a page
    // cursor is mandatory: silently treating a malformed paged response as
    // complete would reconcile against only a partial snapshot.
    if (!boot.has_more) break
    if (!boot.page_cursor) throw new Error('Bootstrap response has_more=true without page_cursor')
    pageCursor = boot.page_cursor
    if (page === MAX_BOOTSTRAP_PAGES - 1) {
      throw new Error(`Bootstrap exceeded ${MAX_BOOTSTRAP_PAGES} pages`)
    }
  }

  // 对账在所有页到齐之后统一进行(见 pull-reconcile)。
  await db.transaction('rw', [db.tabGroups, db.tabGroupItems, db.bookmarks, db.folders, db.tags], async () => {
    await reconcileBootstrap(serverIds)
  })

  const now = new Date().toISOString()
  await saveSyncState({ cursor, last_sync_at: now, last_bootstrap_at: now })
  return { applied, forbidden: false, bootstrapped: true }
}






