import { describe, expect, it } from 'vitest'
import { bootstrapSyncChanges } from '../src/lib/sync/sync-bootstrap'
import { pushSyncOperations } from '../src/lib/sync/sync'
import { emitSyncChange } from '../src/lib/sync/sync-emit'
import { createSqliteD1, type SqliteD1Harness } from './helpers/sqlite-d1'
import type { SyncEnvelope } from '@tmarks/contracts'

/**
 * R8 BL-3 回归网:bootstrap 对 folder/tag/tab_group_item 下发的必须是
 * 注册表里的**真实 revision**(未跟踪的老行发 null,客户端走 last-write-wins)。
 * 旧实现对每行合成 `rev_<Date.now()>`,任何"bootstrap→编辑→push"都必然撞出
 * revision_mismatch 伪冲突(扩展本地恢复、queue-repair 循环、API-key 客户端)。
 */
const USER = 'user-1'
const DEVICE = 'device-a'

let opCounter = 0
function folderOp(entityId: string, baseRevision: string | null): SyncEnvelope {
  opCounter += 1
  return {
    client_operation_id: `op-${opCounter}`,
    device_id: DEVICE,
    entity_type: 'bookmark_folder',
    operation: 'upsert',
    entity_id: entityId,
    base_revision: baseRevision,
    payload: { name: 'renamed', parent_id: null, position: 0 },
    created_at: new Date().toISOString(),
  } as SyncEnvelope
}

function registryRevision(h: SqliteD1Harness, entityType: string, entityId: string): string | undefined {
  const row = h.sqlite
    .prepare(
      `SELECT revision FROM sync_entity_revisions WHERE user_id = ? AND entity_type = ? AND entity_id = ?`,
    )
    .get(USER, entityType, entityId) as { revision: string } | undefined
  return row?.revision
}

describe('bootstrap emits real tracked revisions (R8 BL-3)', () => {
  it('folder/tag/tab_group_item changes carry the registry revision, legacy rows null', async () => {
    const h = createSqliteD1(USER)
    try {
      const now = new Date().toISOString()
      h.sqlite
        .prepare(`INSERT INTO bookmark_folders (id, user_id, name, created_at, updated_at) VALUES ('f-new', ?, 'new', ?, ?)`)
        .run(USER, now, now)
      h.sqlite.prepare(`INSERT INTO tags (id, user_id, name) VALUES ('t-new', ?, 'tag')`).run(USER)
      h.sqlite.prepare(`INSERT INTO tab_groups (id, user_id, title) VALUES ('g-1', ?, 'g')`).run(USER)
      h.sqlite
        .prepare(`INSERT INTO tab_group_items (id, group_id, title, url, position) VALUES ('i-1', 'g-1', 'i', 'https://example.com/i', 0)`)
        .run()
      // 旧时代行:没有任何注册表条目。
      h.sqlite
        .prepare(`INSERT INTO bookmark_folders (id, user_id, name) VALUES ('f-legacy', ?, 'legacy')`)
        .run(USER)

      await emitSyncChange(h.db, USER, 'bookmark_folder', 'f-new', 'upsert')
      await emitSyncChange(h.db, USER, 'tag', 't-new', 'upsert')
      await emitSyncChange(h.db, USER, 'tab_group_item', 'i-1', 'upsert')

      const page = await bootstrapSyncChanges(h.db, USER, { pageSize: 100 })
      const byEntity = (bucket: 'bookmark_folders' | 'tags' | 'tab_group_items', id: string) =>
        page[bucket].find((change) => change.entity_id === id)

      expect(byEntity('bookmark_folders', 'f-new')?.revision).toBe(registryRevision(h, 'bookmark_folder', 'f-new'))
      expect(byEntity('tags', 't-new')?.revision).toBe(registryRevision(h, 'tag', 't-new'))
      expect(byEntity('tab_group_items', 'i-1')?.revision).toBe(registryRevision(h, 'tab_group_item', 'i-1'))
      // 未跟踪的老行 → null(last-write-wins),不再是合成的 rev_<ts>。
      const legacy = byEntity('bookmark_folders', 'f-legacy')
      expect(legacy?.revision).toBeNull()
      expect(String(legacy?.revision)).not.toMatch(/^rev_/)
    } finally {
      h.close()
    }
  })

  it('bootstrap → edit → push with the bootstrap revision no longer false-conflicts', async () => {
    const h = createSqliteD1(USER)
    try {
      const now = new Date().toISOString()
      h.sqlite
        .prepare(`INSERT INTO bookmark_folders (id, user_id, name, created_at, updated_at) VALUES ('f-x', ?, 'x', ?, ?)`)
        .run(USER, now, now)
      await emitSyncChange(h.db, USER, 'bookmark_folder', 'f-x', 'upsert')

      const page = await bootstrapSyncChanges(h.db, USER, { pageSize: 100 })
      const bootstrapRevision = page.bookmark_folders.find((change) => change.entity_id === 'f-x')?.revision
      expect(bootstrapRevision).toBeTruthy()
      expect(typeof bootstrapRevision).toBe('string')

      // 修复前:bootstrap 合成 rev_<Date.now()> ≠ 注册表值 → 这里必然 conflict。
      const result = await pushSyncOperations(h.db, USER, DEVICE, [folderOp('f-x', bootstrapRevision)])
      expect(result.accepted).toHaveLength(1)
      expect(result.conflicts).toHaveLength(0)
      const renamed = h.sqlite.prepare(`SELECT name FROM bookmark_folders WHERE id = 'f-x'`).get()
      expect(renamed).toEqual({ name: 'renamed' })
    } finally {
      h.close()
    }
  })
})
