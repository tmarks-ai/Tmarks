import Dexie from 'dexie'
import { afterEach, describe, expect, it } from 'vitest'
import { TMarkDB } from '../src/lib/db'

const databaseNames: string[] = []

afterEach(async () => {
  await Promise.all(databaseNames.splice(0).map(async (name) => {
    await Dexie.delete(name)
  }))
})

describe('TMarkDB v5 to v6 migration', () => {
  it('preserves legacy dirty changes as full-field upserts and keeps revision as base revision', async () => {
    const name = uniqueName()
    databaseNames.push(name)
    const legacy = new Dexie(name)
    legacy.version(5).stores({
      bookmarks: 'id, folder_id, url',
      folders: 'id, parent_id',
      tags: 'id, name',
      tabGroups: 'id, parent_id',
      tabGroupItems: 'id, group_id, url',
      meta: 'id',
      syncState: 'id',
      snapshotQueue: 'id, created_at',
    })
    await legacy.open()
    await legacy.table('bookmarks').put({ id: 'bookmark-1', title: 'Legacy', url: 'https://example.com', revision: 'rev-1', dirty: true })
    await legacy.table('folders').put({ id: 'folder-1', name: 'Folder', parent_id: null, dirty: false })
    await legacy.table('tags').put({ id: 'tag-1', name: 'Tag', color: null, dirty: true })
    await legacy.table('syncState').put({ id: 'singleton', cursor: 'cursor-1', mode: 'member_sync' })
    await legacy.close()

    const upgraded = new TMarkDB(name)
    await upgraded.open()
    const bookmark = await upgraded.bookmarks.get('bookmark-1')
    const folder = await upgraded.folders.get('folder-1')
    const tag = await upgraded.tags.get('tag-1')
    const state = await upgraded.syncState.get('singleton')

    expect(bookmark).toMatchObject({ base_revision: 'rev-1', pending_op: 'upsert' })
    expect(bookmark?.dirty_fields).toContain('url')
    expect(bookmark?.dirty_fields).toContain('tags')
    expect(folder).toMatchObject({ base_revision: null, dirty_fields: [], pending_op: null })
    expect(tag).toMatchObject({ base_revision: null, pending_op: 'upsert' })
    expect(tag?.dirty_fields).toContain('name')
    expect(state).toMatchObject({ cursor: 'cursor-1', mode: 'local_only', last_sync_at: null, last_bootstrap_at: null })
    await upgraded.close()
  })

  it('maps deleted legacy rows to delete tombstones without dropping their fields', async () => {
    const name = uniqueName()
    databaseNames.push(name)
    const legacy = new Dexie(name)
    legacy.version(5).stores({
      bookmarks: 'id, folder_id, url',
      folders: 'id, parent_id',
      tags: 'id, name',
      tabGroups: 'id, parent_id',
      tabGroupItems: 'id, group_id, url',
      meta: 'id',
      syncState: 'id',
      snapshotQueue: 'id, created_at',
    })
    await legacy.open()
    await legacy.table('bookmarks').put({ id: 'deleted-1', title: 'Deleted', url: 'https://deleted.example', deleted_at: '2026-08-03T00:00:00.000Z', dirty: true })
    await legacy.close()

    const upgraded = new TMarkDB(name)
    await upgraded.open()
    await expect(upgraded.bookmarks.get('deleted-1')).resolves.toMatchObject({ pending_op: 'delete', dirty_fields: expect.arrayContaining(['deleted_at', 'url']) })
    await upgraded.close()
  })
})

describe('TMarkDB v7 migration', () => {
  it('removes the retired snapshot queue store', async () => {
    const name = uniqueName()
    databaseNames.push(name)
    const legacy = new Dexie(name)
    legacy.version(6).stores({
      bookmarks: 'id, folder_id, url',
      folders: 'id, parent_id',
      tags: 'id, name',
      tabGroups: 'id, parent_id',
      tabGroupItems: 'id, group_id, url',
      meta: 'id',
      syncState: 'id',
      snapshotQueue: 'id, created_at',
      syncQueue: 'id, [entity_type+entity_id+operation], entity_type, entity_id, status, next_retry_at, created_at',
      operationLogs: 'id, created_at, entity_type, entity_id, status',
    })
    await legacy.open()
    await legacy.table('snapshotQueue').put({ id: 'retired-1', created_at: new Date().toISOString() })
    await legacy.close()

    const upgraded = new TMarkDB(name)
    await upgraded.open()
    expect(upgraded.tables.map((table) => table.name)).not.toContain('snapshotQueue')
    await upgraded.close()
  })
})

describe('TMarkDB v8 migration', () => {
  it('adds the snapshot uploads buffer store while keeping snapshotQueue retired', async () => {
    const name = uniqueName()
    databaseNames.push(name)
    const upgraded = new TMarkDB(name)
    await upgraded.open()
    const tableNames = upgraded.tables.map((table) => table.name)
    expect(tableNames).toContain('snapshotUploads')
    expect(tableNames).not.toContain('snapshotQueue')
    // 缓冲区表可读写一条 pending 上传记录。
    await upgraded.snapshotUploads.put({ id: 'su-1', bookmark_id: 'bm-1', title: 'T', url: 'https://x', html_content: '<html/>', status: 'pending', retry_count: 0, next_retry_at: null, error_code: null, error_message: null, created_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    await expect(upgraded.snapshotUploads.get('su-1')).resolves.toMatchObject({ status: 'pending' })
    await upgraded.close()
  })
})

function uniqueName(): string {
  return `tmark-test-${crypto.randomUUID()}`
}
