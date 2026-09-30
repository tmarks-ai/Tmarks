import { db, DEFAULT_SYNC_STATE, type LocalBookmark, type LocalFolder, type LocalTag, type LocalTabGroup, type LocalTabGroupItem, type SyncStateRecord } from './index'
import type { DeviceId } from '@tmarks/contracts'

export async function getSyncState(): Promise<SyncStateRecord> {
  const rec = await db.syncState.get('singleton')
  return rec ?? { ...DEFAULT_SYNC_STATE }
}

export async function saveSyncState(patch: Partial<Omit<SyncStateRecord, 'id'>>): Promise<void> {
  const current = await getSyncState()
  await db.syncState.put({ ...current, ...patch, id: 'singleton' })
}

export async function getOrCreateDeviceId(): Promise<DeviceId> {
  // 事务内的读-判-写:popup 与 SW 冷启动可能在首跑同时观察到"缺失",
  // 各铸一个 id 后写覆盖,留下两个 device 行与归属混乱。
  return db.transaction('rw', db.meta, async () => {
    const meta = await db.meta.get('singleton')
    if (meta) return meta.device_id
    const device_id = (crypto.randomUUID?.() ?? generateFallbackId()) as DeviceId
    await db.meta.put({ id: 'singleton', device_id, created_at: new Date().toISOString() })
    return device_id
  })
}

function generateFallbackId(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

export async function getDirtyEntities(): Promise<{
  bookmarks: LocalBookmark[]
  folders: LocalFolder[]
  tags: LocalTag[]
  tabGroups: LocalTabGroup[]
  tabGroupItems: LocalTabGroupItem[]
}> {
  const [bookmarks, folders, tags, tabGroups, tabGroupItems] = await Promise.all([
    db.bookmarks.toArray(),
    db.folders.toArray(),
    db.tags.toArray(),
    db.tabGroups.toArray(),
    db.tabGroupItems.toArray(),
  ])
  return {
    bookmarks: bookmarks.filter((b) => b.dirty_fields.length > 0),
    folders: folders.filter((f) => f.dirty_fields.length > 0),
    tags: tags.filter((t) => t.dirty_fields.length > 0),
    tabGroups: tabGroups.filter((g) => g.dirty_fields.length > 0),
    tabGroupItems: tabGroupItems.filter((i) => i.dirty_fields.length > 0),
  }
}
