import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db, type LocalBookmark } from '../src/lib/db'
import { restoreLocalExport, type RestoreResult } from '../src/lib/data-export/local-restore'
import type { LocalExportData } from '../src/lib/data-export/local-export'

function mkBookmark(id: string, updatedAt: string, dirty: string[] = []): LocalBookmark {
  return {
    id, user_id: '' as never, title: id, url: `https://${id}.example`,
    description: null, cover_image: null, favicon: null, folder_id: null,
    is_pinned: false, pin_order: null, is_archived: false, is_todo: false,
    is_private: false, position: 0, click_count: 0, last_clicked_at: null,
    revision: null, folder_path: [], created_at: updatedAt, updated_at: updatedAt,
    deleted_at: null, tags: [],
    base_revision: null, dirty_fields: dirty, pending_op: null,
  } as LocalBookmark
}

describe('restoreLocalExport (RC-H 本地优先跳过)', () => {
  beforeEach(async () => {
    // restoreLocalExport 用模块单例 db(name 'tmark');每个用例前清空相关表避免污染。
    await Promise.all([
      db.bookmarks.clear(),
      db.folders.clear(),
      db.tags.clear(),
      db.tabGroups.clear(),
      db.tabGroupItems.clear(),
      db.syncQueue.clear(),
      db.operationLogs.clear(),
      db.syncState.clear(),
    ])
  })
  afterEach(async () => {
    await Promise.all([db.bookmarks.clear(), db.syncQueue.clear(), db.operationLogs.clear()])
  })

  it('skips rows where local is newer; restores absent/local-older rows', async () => {
    // 本地 b1 已有较新版本(updated_at 08-10),导出行较旧(08-01)→ 应跳过,不覆盖。
    await db.bookmarks.put(mkBookmark('b1', '2026-08-10T00:00:00Z'))
    const data: LocalExportData = {
      version: 1, exported_at: '2026-08-09T00:00:00Z',
      bookmarks: [
        mkBookmark('b1', '2026-08-01T00:00:00Z'), // 较旧 → 跳过
        mkBookmark('b2', '2026-08-01T00:00:00Z'), // 本地缺失 → 恢复
      ],
      folders: [], tags: [], tabGroups: [], tabGroupItems: [],
    }
    const result: RestoreResult = await restoreLocalExport(data)
    expect(result.skipped).toBe(1)
    expect(result.bookmarks).toBe(1)
    // b1 本地新版本保留
    const b1 = await db.bookmarks.get('b1')
    expect(b1?.updated_at).toBe('2026-08-10T00:00:00Z')
    // b2 恢复入库
    const b2 = await db.bookmarks.get('b2')
    expect(b2).toBeTruthy()
    expect(b2?.pending_op).toBe('upsert')
  })

  it('skips rows with local unsynced edits even without newer timestamp', async () => {
    // 本地 b1 有未上报改动(dirty_fields 非空)→ 视为更新,跳过(即使导出时间戳相同)。
    await db.bookmarks.put(mkBookmark('b1', '2026-08-01T00:00:00Z', ['title']))
    const data: LocalExportData = {
      version: 1, exported_at: '2026-08-01T00:00:00Z',
      bookmarks: [mkBookmark('b1', '2026-08-01T00:00:00Z')],
      folders: [], tags: [], tabGroups: [], tabGroupItems: [],
    }
    const result = await restoreLocalExport(data)
    expect(result.skipped).toBe(1)
    expect(result.bookmarks).toBe(0)
  })
})
