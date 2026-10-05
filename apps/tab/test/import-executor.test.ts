import { afterEach, describe, expect, it } from 'vitest'
import Dexie from 'dexie'
import { executeImport } from '../src/lib/import/executor'
import { normalizeImportBookmark } from '../src/lib/import/types'

const names: string[] = []

afterEach(async () => {
  await Promise.all(names.splice(0).map((name) => Dexie.delete(name)))
})

describe('import executor', () => {
  it('writes bookmarks, skips existing URLs, and reports counts', async () => {
    const first = normalizeImportBookmark({ url: 'https://example.com', title: 'Example' }, 0, 'json')!
    const duplicate = normalizeImportBookmark({ url: 'HTTPS://EXAMPLE.com/#x', title: 'Dup' }, 1, 'json')!

    const result = await executeImport([first, duplicate])

    expect(result.imported).toBe(1)
    expect(result.skipped).toBe(1)
    expect(result.failed).toBe(0)
    expect(result.errors).toHaveLength(0)
  })

  it('skips URLs that already exist in the provided database', async () => {
    const name = `tmark-import-${crypto.randomUUID()}`
    names.push(name)
    const { TMarkDB } = await import('../src/lib/db')
    const db = new TMarkDB(name)
    await db.open()
    await db.bookmarks.put({
      id: 'existing-1', user_id: '' as never, title: 'Existing', url: 'https://example.com',
      description: null, cover_image: null, favicon: null, folder_id: null,
      is_pinned: false, pin_order: null, is_archived: false, is_todo: false,
      position: 0, click_count: 0, last_clicked_at: null, revision: null, folder_path: [],
      created_at: new Date().toISOString(), updated_at: new Date().toISOString(), deleted_at: null,
      tags: [], base_revision: null, dirty_fields: [], pending_op: null,
    })

    const draft = normalizeImportBookmark({ url: 'https://example.com', title: 'Should Skip' }, 0, 'json')!
    const result = await executeImport([draft], { db })

    expect(result.imported).toBe(0)
    expect(result.skipped).toBe(1)
    await db.close()
  })

  // R8 TA-3: 执行器现在注入预扫的归一化 URL 索引(buildBookmarkLookupIndex),
  // 替代 saveBookmarkLocal 每存一次的全表扫描——20k 导入曾在此冻结页面。
  // 索引路径必须保持墓碑语义:活行跳过,软删行可重新导入。
  // (saveBookmarkLocal 内部固定写默认 db——executor 的 options.db 只喂给
  // 去重扫描,这是既有行为;本用例因此也走默认 db。)
  it('pre-built lookup index keeps tombstone semantics: live rows skip, deleted rows re-import', async () => {
    const { db } = await import('../src/lib/db')
    const now = new Date().toISOString()
    const base = {
      user_id: '' as never, description: null, cover_image: null, favicon: null, folder_id: null,
      is_pinned: false, pin_order: null, is_archived: false, is_todo: false,
      position: 0, click_count: 0, last_clicked_at: null, revision: null, folder_path: [],
      created_at: now, updated_at: now, tags: [], base_revision: null, dirty_fields: [], pending_op: null,
    }
    await db.bookmarks.put({ ...base, id: 'live-ta3', title: 'Live', url: 'https://live.example.com', deleted_at: null })
    await db.bookmarks.put({ ...base, id: 'dead-ta3', title: 'Dead', url: 'https://dead.example.com', deleted_at: now })

    const live = normalizeImportBookmark({ url: 'https://live.example.com', title: 'Live dup' }, 0, 'json')!
    const dead = normalizeImportBookmark({ url: 'https://dead.example.com', title: 'Resurrected' }, 1, 'json')!
    const fresh = normalizeImportBookmark({ url: 'https://fresh.example.com', title: 'Fresh' }, 2, 'json')!
    const result = await executeImport([live, dead, fresh])

    expect(result.imported).toBe(2)
    expect(result.skipped).toBe(1)
    const rows = await db.bookmarks.where('url').equals('https://dead.example.com').toArray()
    expect(rows.some((row) => !row.deleted_at)).toBe(true)
    await db.bookmarks.bulkDelete(['live-ta3', 'dead-ta3'])
    const created = await db.bookmarks.where('url').equals('https://fresh.example.com').toArray()
    await db.bookmarks.bulkDelete(created.map((row) => row.id))
  })
})
