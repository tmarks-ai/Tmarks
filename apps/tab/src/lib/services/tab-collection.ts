import type { EntityId } from '@tmarks/contracts'
import { db, type LocalTabGroup, type LocalTabGroupItem } from '../db'
import { enqueueSyncOperation } from '../db/queue'
import { logOperation } from '../db/operation-logs'
import { isLiveTabGroup, isLiveTabGroupItem } from '../db/live-filter'
import { ITEM_DIRTY_FIELDS, groupPayload } from '../db/tab-collections'
import { buildTabGroupFingerprint } from '../utils/fingerprint'
import { isCollectableTabUrl } from './tab-collection-rules'

const GROUP_DIRTY_FIELDS = ['title', 'color', 'tags', 'parent_id', 'is_folder', 'position', 'item_count']

function tabGroupItemUpsertPayload(it: LocalTabGroupItem): Record<string, unknown> {
  return { group_id: it.group_id, title: it.title, url: it.url, favicon: it.favicon, position: it.position, is_pinned: it.is_pinned, is_todo: it.is_todo, is_archived: it.is_archived }
}

function newEntityId(): EntityId {
  return crypto.randomUUID() as EntityId
}

function defaultTitle(): string {
  // 跟随浏览器区域设置命名(旧版硬编码 zh-CN)。
  return new Date().toLocaleString(undefined, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
}

interface CollectOptions {
  /** 新组标题;缺省用本地化时间戳。 */
  title?: string
  /** 新组父文件夹(target_group_id 模式下忽略)。 */
  parent_id?: EntityId | null
  /** 加入到既有组(而非新建)。 */
  target_group_id?: EntityId
  /** 仅采集指定 tabId(选中若干标签页时);缺省采集全部有效标签页。 */
  selectedTabIds?: Set<number>
}

export interface CollectResult {
  success: boolean
  groupId?: EntityId
  count?: number
  /** 命中重复指纹(同一组已采集过),未新建。 */
  duplicate?: boolean
  /** 被采集并入库的标签页 id(popup 关闭标签页确认用)。 */
  tabIds?: number[]
  /** 本次因单 URL 去重跳过的条目数。 */
  skipped?: number
  /** 失败时为 i18n key(popup 用 t() 翻译)。 */
  error?: string
}

/** 采集当前窗口标签页 → 本地 Dexie(revision 模型,dirty 待同步)。 */
export async function collectCurrentWindowTabs(options: CollectOptions = {}): Promise<CollectResult> {
  const tabs = await chrome.tabs.query({ currentWindow: true })
  return collectTabs(tabs, options)
}

/** 采集给定标签页集合(核心,可被 popup/background 复用)。单 URL 去重(留首)。 */
async function collectTabs(tabs: chrome.tabs.Tab[], options: CollectOptions = {}): Promise<CollectResult> {
  let valid = tabs.filter((t) => isCollectableTabUrl(t.url))
  if (options.selectedTabIds && options.selectedTabIds.size > 0) {
    valid = valid.filter((t) => t.id != null && options.selectedTabIds!.has(t.id))
  }
  if (valid.length === 0) return { success: false, error: 'popup.toast.noTabs' }

  const seen = new Set<string>()
  const items: NewItemInput[] = []
  let skipped = 0
  for (const t of valid) {
    const url = t.url as string
    if (seen.has(url)) {
      skipped++
      continue
    }
    seen.add(url)
    // favicon 优先真实 favIconUrl;缺失置 null(不外发域名到第三方 favicon 服务,避免隐私泄漏)。
    items.push({ title: t.title || url, url, favicon: t.favIconUrl ?? null, tabId: t.id ?? null })
  }
  if (items.length === 0) return { success: false, error: 'popup.toast.noTabs' }

  if (options.target_group_id) {
    const r = await addItemsToGroup(options.target_group_id, items)
    return { ...r, skipped: (r.skipped ?? 0) + skipped }
  }
  const r = await createNewGroup({ title: options.title, parent_id: options.parent_id ?? null, items })
  return { ...r, skipped }
}

interface NewItemInput {
  title: string
  url: string
  favicon: string | null
  /** 来源 tab id;采集后精确关闭"已入库"的标签页用(非 popup 采集时为 null)。 */
  tabId: number | null
}

async function createNewGroup(input: {
  title?: string
  parent_id: EntityId | null
  items: NewItemInput[]
}): Promise<CollectResult> {
  const dupId = await findDuplicateGroup(input)
  if (dupId) return { success: true, duplicate: true, groupId: dupId, count: input.items.length }

  const now = new Date().toISOString()
  const groupId = newEntityId()
  const group: LocalTabGroup = {
    id: groupId,
    title: input.title || defaultTitle(),
    color: null,
    tags: [],
    parent_id: input.parent_id,
    is_folder: false,
    position: 0,
    item_count: input.items.length,
    created_at: now,
    updated_at: now,
    deleted_at: null,
    base_revision: null,
    dirty_fields: GROUP_DIRTY_FIELDS,
    pending_op: 'upsert',
  }
  const groupItems: LocalTabGroupItem[] = input.items.map((it, i) => ({
    id: newEntityId(),
    group_id: groupId,
    title: it.title,
    url: it.url,
    favicon: it.favicon,
    position: i,
    is_pinned: false,
    is_todo: false,
    is_archived: false,
    created_at: now,
    base_revision: null,
    dirty_fields: ITEM_DIRTY_FIELDS,
    pending_op: 'upsert',
  }))

  // db.operationLogs 必须在表列表里:logOperation 写该表,未声明时在事务内
  // 必然抛错(被 logOperation 的 catch 吞掉),采集审计日志静默丢失。
  await db.transaction('rw', [db.tabGroups, db.tabGroupItems, db.syncQueue, db.operationLogs, db.meta], async () => {
    await db.tabGroups.put(group)
    await db.tabGroupItems.bulkPut(groupItems)
    // 入队同步操作(幂等),与写库同事务(RC-D),避免事务外入队在崩溃时产生脏实体无队列项。
    await enqueueSyncOperation({ entityType: 'tab_group', entityId: groupId, operation: 'upsert', baseRevision: null, payload: groupPayload(group) })
    await logOperation({ entity_type: 'tab_group', entity_id: groupId, operation: 'upsert' })
    for (const it of groupItems) {
      await enqueueSyncOperation({ entityType: 'tab_group_item', entityId: it.id, operation: 'upsert', baseRevision: null, payload: tabGroupItemUpsertPayload(it) })
    }
  })
  return { success: true, groupId, count: input.items.length, tabIds: input.items.map((it) => it.tabId).filter((x): x is number => x != null) }
}

/** 向既有组追加条目(新条目 dirty;组 item_count 客户端拥有故亦标 dirty + 入队组 upsert)。单 URL 去重:仅按组内活跃条目 URL 去重(墓碑条目不再阻塞重新添加同 URL)。 */
async function addItemsToGroup(groupId: EntityId, items: NewItemInput[]): Promise<CollectResult> {
  const group = await db.tabGroups.get(groupId)
  if (!group || group.deleted_at) return { success: false, error: 'popup.toast.groupNotFound' }

  // 仅活跃条目参与去重与起始位置计算(RC-A:墓碑条目 pending_op='delete' 不应阻塞同 URL 重新添加,
  // 也不应抬高 nextPos 留空位)。
  const existing = (await db.tabGroupItems.where('group_id').equals(groupId).toArray()).filter(isLiveTabGroupItem)
  const existingUrls = new Set(existing.map((it) => it.url))
  const fresh = items.filter((it) => !existingUrls.has(it.url))
  const skipped = items.length - fresh.length
  if (fresh.length === 0) return { success: true, groupId, count: 0, skipped, duplicate: true, tabIds: [] }

  const nextPos = existing.reduce((max, it) => Math.max(max, it.position), -1) + 1
  const now = new Date().toISOString()

  const newItems: LocalTabGroupItem[] = fresh.map((it, i) => ({
    id: newEntityId(),
    group_id: groupId,
    title: it.title,
    url: it.url,
    favicon: it.favicon,
    position: nextPos + i,
    is_pinned: false,
    is_todo: false,
    is_archived: false,
    created_at: now,
    base_revision: null,
    dirty_fields: ITEM_DIRTY_FIELDS,
    pending_op: 'upsert',
  }))

  // item_count 由服务端按 items 派生(后端 tab_groups 无 item_count 列),组行服务器字段不因增条目而变,
  // 故仅本地刷新展示用 item_count,不标 dirty、不入队 group upsert。
  await db.transaction('rw', [db.tabGroups, db.tabGroupItems, db.syncQueue, db.meta], async () => {
    await db.tabGroupItems.bulkPut(newItems)
    await db.tabGroups.put({ ...group, item_count: group.item_count + newItems.length, updated_at: now })
    for (const it of newItems) {
      await enqueueSyncOperation({ entityType: 'tab_group_item', entityId: it.id, operation: 'upsert', baseRevision: null, payload: tabGroupItemUpsertPayload(it) })
    }
  })
  return { success: true, groupId, count: newItems.length, skipped, tabIds: fresh.map((it) => it.tabId).filter((x): x is number => x != null) }
}

/** 指纹查重:同一标题+父级+条目集合(顺序无关)的组已存在则返回其 id。 */
async function findDuplicateGroup(input: {
  title?: string
  parent_id: EntityId | null
  items: NewItemInput[]
}): Promise<EntityId | null> {
  // RC-F:查重侧须与创建侧用同一"解析后标题"(input.title || defaultTitle()),
  // 否则未命名组创建侧存时间戳、查重侧用空串,两侧指纹 title 段不一致 → 永不命中。
  const resolvedTitle = input.title || defaultTitle()
  const newFp = buildTabGroupFingerprint({
    title: resolvedTitle,
    parentId: input.parent_id,
    items: input.items.map((it, i) => ({ position: i, title: it.title, url: it.url })),
  })
  const groups = await db.tabGroups.toArray()
  for (const g of groups) {
    if (!isLiveTabGroup(g) || g.is_folder) continue
    // 指纹仅按活跃条目构造(RC-A:墓碑条目不计入,否则删条目后重新采集会因残留墓碑而无法命中查重)。
    const gItems = (await db.tabGroupItems.where('group_id').equals(g.id).toArray()).filter(isLiveTabGroupItem)
    const fp = buildTabGroupFingerprint({
      title: g.title,
      parentId: g.parent_id,
      items: gItems.map((it) => ({ position: it.position, title: it.title, url: it.url })),
    })
    if (fp === newFp) return g.id
  }
  return null
}

/** 关闭已收纳的标签页(采集后"是否关闭"确认用)。 */
export async function closeCollectedTabs(tabIds: number[]): Promise<void> {
  if (tabIds.length > 0) await chrome.tabs.remove(tabIds)
}
