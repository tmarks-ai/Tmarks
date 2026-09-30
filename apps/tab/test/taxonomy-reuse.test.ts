import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db, type LocalTag, type LocalFolder } from '../src/lib/db'
import { ensureBookmarkFolderPath, ensureTag } from '../src/lib/db/bookmark-helpers'
import { loadContext } from '../src/lib/ai/organizer'

function tag(name: string, clickCount = 0): LocalTag {
  return {
    id: crypto.randomUUID(), name, color: null, click_count: clickCount, bookmark_count: 0,
    created_at: '2024-01-01T00:00:00.000Z', updated_at: '2024-01-01T00:00:00.000Z',
    base_revision: null, dirty_fields: [], pending_op: null,
  } as LocalTag
}

function folder(name: string, parentId: string | null = null): LocalFolder {
  return {
    id: crypto.randomUUID(), name, parent_id: parentId,
    created_at: '2024-01-01T00:00:00.000Z', updated_at: '2024-01-01T00:00:00.000Z', deleted_at: null,
    base_revision: null, dirty_fields: [], pending_op: null,
  } as unknown as LocalFolder
}

beforeEach(async () => {
  await db.tags.clear()
  await db.folders.clear()
  await db.syncQueue.clear()
})
afterEach(async () => {
  await db.tags.clear()
  await db.folders.clear()
  await db.syncQueue.clear()
})

describe('ensureTag reuse', () => {
  // Regression: matching was exact-case, and model output casing is unstable —
  // linux / Linux / LINUX became three separate tags.
  it('reuses an existing tag regardless of casing', async () => {
    await db.tags.put(tag('Linux', 5))

    const reused = await ensureTag('linux')

    expect(reused.name).toBe('Linux')
    expect(await db.tags.count()).toBe(1)
  })

  it('creates the tag only when no case-variant exists', async () => {
    const created = await ensureTag('Rust')

    expect(created.name).toBe('Rust')
    expect(await db.tags.count()).toBe(1)
    expect(await db.syncQueue.count()).toBe(1)
  })

  it('ignores a case-variant that is pending deletion', async () => {
    await db.tags.put({ ...tag('Linux'), pending_op: 'delete' })

    const created = await ensureTag('linux')

    expect(created.id).not.toBeUndefined()
    expect(await db.tags.count()).toBe(2)
  })

  // Server parity: the server stores tag names clamped to 50, so a 51+ char
  // name and its 50-char prefix are the same tag there. Truncating before the
  // dedupe keeps local from storing (and pushing) two near-duplicate rows.
  it('truncates overlong names to 50 before dedupe', async () => {
    const over = '标'.repeat(55)

    const created = await ensureTag(over)
    expect(created.name).toBe('标'.repeat(50))

    // A later save of the 50-char prefix reuses the row, not a new one.
    const reused = await ensureTag('标'.repeat(50))
    expect(reused.id).toBe(created.id)
    expect(await db.tags.count()).toBe(1)
  })

  it('throws on an empty name instead of creating a nameless tag', async () => {
    await expect(ensureTag('   ')).rejects.toThrow()
    expect(await db.tags.count()).toBe(0)
  })
})

describe('ensureBookmarkFolderPath reuse', () => {
  it('reuses an existing folder regardless of casing', async () => {
    const existing = folder('Tools')
    await db.folders.put(existing)

    const id = await ensureBookmarkFolderPath(['tools'])

    expect(id).toBe(existing.id)
    expect(await db.folders.count()).toBe(1)
  })

  it('scopes the case-insensitive match to the same parent', async () => {
    const dev = folder('Dev')
    const design = folder('Design')
    const devTools = folder('Tools', dev.id)
    await db.folders.bulkPut([dev, design, devTools])

    // "tools" under Design must not resolve to Dev/Tools just because the name
    // matches case-insensitively.
    const id = await ensureBookmarkFolderPath(['design', 'tools'])

    const created = await db.folders.get(id!)
    expect(created?.parent_id).toBe(design.id)
    expect(await db.folders.count()).toBe(4)
  })

  // Server parity: the sync plane clamps folder names to 120; storing the
  // full-length name locally would diverge from the server row until the next
  // pull overwrites it.
  it('truncates folder names to the 120-char server clamp', async () => {
    const id = await ensureBookmarkFolderPath(['开'.repeat(200), '工具'])

    const rows = await db.folders.toArray()
    const primary = rows.find((f) => f.parent_id === null)
    expect(primary?.name).toBe('开'.repeat(120))
    const secondary = rows.find((f) => f.id === id)
    expect(secondary?.name).toBe('工具')
  })
})

describe('classifier context sampling', () => {
  // Regression: the loader used limit() without orderBy, which returns rows in
  // uuid order — past the cap the model never saw the rest of the library and
  // minted near-duplicates of tags it could not see.
  it('ranks the tag library by usage, most-used first', async () => {
    await db.tags.bulkPut([
      tag('rare', 0),
      tag('common', 40),
      tag('occasional', 5),
      tag('popular', 100),
    ])

    const { existingTags } = await loadContext()

    expect(existingTags).toEqual(['popular', 'common', 'occasional', 'rare'])
  })

  it('caps the library at the prompt limit, keeping the most-used end', async () => {
    const rows = Array.from({ length: 340 }, (_, i) => tag(`tag-${String(i).padStart(3, '0')}`, 340 - i))
    await db.tags.bulkPut(rows)

    const { existingTags } = await loadContext()

    expect(existingTags).toHaveLength(300)
    expect(existingTags[0]).toBe('tag-000')
    expect(existingTags).not.toContain('tag-339')
  })

  it('excludes tags pending deletion', async () => {
    await db.tags.bulkPut([tag('alive', 1), { ...tag('dying', 99), pending_op: 'delete' }])

    const { existingTags } = await loadContext()

    expect(existingTags).toEqual(['alive'])
  })

  it('builds two-level folder paths for the prompt', async () => {
    const dev = folder('开发')
    await db.folders.put(dev)
    await db.folders.put(folder('前端', dev.id))

    const { existingFolders } = await loadContext()

    const paths = existingFolders.map((f) => f.path.join('/'))
    expect(paths).toContain('开发/前端')
  })
})
