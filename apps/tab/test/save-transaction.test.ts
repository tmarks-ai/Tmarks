import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../src/lib/db'
import { persistBookmarkSave } from '../src/popup/save-transaction'
import { getLastFolderId, isHttpImageUrl, mergeSelectedTags } from '../src/popup/save-helpers'

/**
 * persistBookmarkSave 是弹窗保存的落库事务(全有或全无 + base 事务内解析),
 * 从 useBookmarkSave 拆出后才可直接测试。这些测试钉住三个数据完整性不变量:
 * 同 URL 不双行(事务内按 normalizeUrlKey 复查合并)、二次保存不写回陈旧字段
 * (按 id 重读最新行)、新标签随书签同事务落地。
 */

beforeEach(async () => {
  await Promise.all([db.bookmarks.clear(), db.tags.clear(), db.folders.clear(), db.syncQueue.clear(), db.operationLogs.clear()])
})
afterEach(async () => {
  await Promise.all([db.bookmarks.clear(), db.tags.clear(), db.folders.clear(), db.syncQueue.clear(), db.operationLogs.clear()])
})

const baseInput = {
  existing: null,
  url: 'https://example.com/page',
  title: 'Example',
  nextDescription: null,
  nextCover: null,
  favicon: null,
  userPickedFolder: false,
  folderId: null,
  aiFolderPath: [] as string[],
  isPrivate: false,
  isTodo: false,
  uniqueSelectedNames: [] as string[],
  knownByName: new Map<string, { id: string; name: string; color: string | null }>(),
}

describe('persistBookmarkSave data-integrity invariants', () => {
  it('creates a fresh row, a queue op and an audit log entry when nothing exists', async () => {
    const bm = await persistBookmarkSave(baseInput)
    expect(bm.id).toBeTruthy()
    expect((await db.bookmarks.toArray()).length).toBe(1)
    const queue = await db.syncQueue.toArray()
    expect(queue.length).toBe(1)
    expect(queue[0]?.entity_type).toBe('bookmark')
    expect((await db.operationLogs.toArray()).length).toBe(1)
  })

  it('merges into a normalized-URL variant row instead of minting a duplicate', async () => {
    // 弹窗快照为空(existing=null),但库里已有同页变体(尾斜杠)——另一设备
    // 保存或后台 pull 写入。按 normalizeUrlKey 复查必须并入该行。
    const variantId = crypto.randomUUID()
    await db.bookmarks.put({
      id: variantId, user_id: '', title: 'Old title', url: 'https://example.com/page/',
      description: null, cover_image: null, favicon: null, folder_id: null,
      is_pinned: false, pin_order: null, is_archived: false, is_todo: false, is_private: false,
      position: 0, click_count: 0, last_clicked_at: null, revision: null, normalized_url: null,
      folder_path: [], created_at: '2024-01-01T00:00:00.000Z', updated_at: '2024-01-01T00:00:00.000Z', deleted_at: null,
      tags: [], base_revision: null, dirty_fields: [], pending_op: null,
    })

    const bm = await persistBookmarkSave(baseInput)
    expect(bm.id).toBe(variantId)
    expect((await db.bookmarks.toArray()).length).toBe(1)
    expect(bm.title).toBe('Example')
  })

  it('spreads the fresh DB row, not the stale existing snapshot', async () => {
    // 快照说未置顶,但后台 pull 已把该行置顶——保存后置顶必须保留。
    const id = crypto.randomUUID()
    const fresh = {
      id, user_id: '', title: 'Old title', url: 'https://example.com/page',
      description: null, cover_image: null, favicon: null, folder_id: null,
      is_pinned: true, pin_order: 3, is_archived: false, is_todo: false, is_private: false,
      position: 7, click_count: 4, last_clicked_at: null, revision: null, normalized_url: null,
      folder_path: [], created_at: '2024-01-01T00:00:00.000Z', updated_at: '2024-01-01T00:00:00.000Z', deleted_at: null,
      tags: [], base_revision: null, dirty_fields: [], pending_op: null,
    }
    await db.bookmarks.put(fresh)
    const staleSnapshot = { ...fresh, is_pinned: false, pin_order: null, position: 0 }

    const bm = await persistBookmarkSave({ ...baseInput, existing: staleSnapshot as never })
    expect(bm.is_pinned).toBe(true)
    expect(bm.pin_order).toBe(3)
    expect(bm.position).toBe(7)
  })

  it('creates unknown tags inside the transaction and links them to the bookmark', async () => {
    const bm = await persistBookmarkSave({
      ...baseInput,
      uniqueSelectedNames: ['Linux', 'brand-new-tag'],
      knownByName: new Map([['linux', { id: 'tag-linux', name: 'Linux', color: null }]]),
    })
    const tags = await db.tags.toArray()
    expect(tags.map((t) => t.name)).toEqual(['brand-new-tag'])
    expect(bm.tags.map((t) => t.name).sort()).toEqual(['Linux', 'brand-new-tag'])
    // 新标签的创建与其入队在同一事务:队列里同时有书签与标签的 op。
    const ops = (await db.syncQueue.toArray()).map((q) => q.entity_type).sort()
    expect(ops).toEqual(['bookmark', 'tag'])
  })

  it('honours the user-picked folder over the AI suggested path', async () => {
    await db.folders.put({
      id: 'folder-user', user_id: '', name: '用户目录', parent_id: null,
      created_at: '2024-01-01T00:00:00.000Z', updated_at: '2024-01-01T00:00:00.000Z', deleted_at: null,
      base_revision: null, dirty_fields: [], pending_op: null,
    } as never)
    const bm = await persistBookmarkSave({
      ...baseInput,
      userPickedFolder: true,
      folderId: 'folder-user',
      aiFolderPath: ['AI 建议', '子目录'],
    })
    expect(bm.folder_id).toBe('folder-user')
    // AI 路径未消费:不应出现 AI 目录行。
    expect((await db.folders.toArray()).length).toBe(1)
  })
})

describe('save-helpers pure utilities', () => {
  it('mergeSelectedTags keeps existing spellings and dedupes case-insensitively', () => {
    expect(mergeSelectedTags(['LLM'], ['llm', 'Rust'])).toEqual(['LLM', 'Rust'])
    expect(mergeSelectedTags([], ['a', 'A', 'b'])).toEqual(['a', 'b'])
  })

  it('isHttpImageUrl accepts only http(s) and rejects empty/data/blob', () => {
    expect(isHttpImageUrl('https://example.com/a.png')).toBe(true)
    expect(isHttpImageUrl('http://example.com/a.png')).toBe(true)
    expect(isHttpImageUrl('data:image/png;base64,xxx')).toBe(false)
    expect(isHttpImageUrl('blob:https://x/y')).toBe(false)
    expect(isHttpImageUrl(undefined)).toBe(false)
    expect(isHttpImageUrl('not a url')).toBe(false)
  })

  it('last-folder persistence round-trips through chrome.storage.local', async () => {
    // fake-indexeddb 环境没有 chrome;save-helpers 的 chrome 调用需 stub。
    const store = new Map<string, unknown>()
    viStubChrome(store)
    try {
      await (await import('../src/popup/save-helpers')).setLastFolderId('f-1')
      expect(await getLastFolderId()).toBe('f-1')
    } finally {
      viUnstubChrome()
    }
  })
})

// vitest 的 vi 全局在此文件里以动态引用拿到,避免顶层 import 顺序问题。
let chromeStub: unknown
function viStubChrome(store: Map<string, unknown>): void {
  chromeStub = globalThis.chrome
  ;(globalThis as Record<string, unknown>).chrome = {
    storage: {
      local: {
        get: (key: string, cb: (o: Record<string, unknown>) => void) => { cb({ [key]: store.get(key) }) },
        set: (values: Record<string, unknown>, cb: () => void) => { for (const [k, v] of Object.entries(values)) store.set(k, v); cb() },
      },
    },
  }
}
function viUnstubChrome(): void {
  if (chromeStub === undefined) delete (globalThis as Record<string, unknown>).chrome
  else (globalThis as Record<string, unknown>).chrome = chromeStub
}
