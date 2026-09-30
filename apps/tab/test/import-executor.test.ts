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
})
