import { describe, expect, it } from 'vitest'
import { dedupeImportBookmarks, normalizeImportBookmark } from '../src/lib/import/types'
import { parseBookmarksHtml, parseBookmarksJson, parseCsvUrls, parseImportFile, parseTextUrls, traverseBookmarksTree, type BookmarkTreeNode } from '../src/lib/import/parsers'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

describe('bookmark import parsers', () => {
  it('parses Netscape HTML links and keeps folder/title data', () => {
    const result = parseBookmarksHtml('<DL><DT><H3>Work</H3><DT><A HREF="https://Example.com/#x">Example</A></DL>')
    expect(result.items).toHaveLength(1)
    expect(result.items[0]).toMatchObject({ title: 'Example', url: 'https://Example.com/#x' })
  })

  it('preserves nested folder hierarchy via recursive traversal (RC-G)', () => {
    // 标准 Netscape 嵌套:<dt><h3> 后跟嵌套 <dl>(作为 dt 的直接子)。
    // 此前 querySelectorAll+data-level 扁平化会把所有书签误归最深文件夹;
    // 递归遍历应还原层级:A→[Work],B→[Work,Deep],C→[]。
    const tree: BookmarkTreeNode = {
      tag: 'dl',
      children: [
        {
          tag: 'dt', children: [
            { tag: 'h3', text: 'Work', children: [] },
            {
              tag: 'dl', children: [
                { tag: 'dt', children: [{ tag: 'a', text: 'A', href: 'https://a.example', children: [] }] },
                {
                  tag: 'dt', children: [
                    { tag: 'h3', text: 'Deep', children: [] },
                    { tag: 'dl', children: [{ tag: 'dt', children: [{ tag: 'a', text: 'B', href: 'https://b.example', children: [] }] }] },
                  ],
                },
              ],
            },
          ],
        },
        { tag: 'dt', children: [{ tag: 'a', text: 'C', href: 'https://c.example', children: [] }] },
      ],
    }
    const collected: Array<{ url: string; path: string[] }> = []
    traverseBookmarksTree(tree, (url, _title, folderPath) => collected.push({ url, path: folderPath }))
    const byUrl = new Map(collected.map((it) => [it.url, it]))
    expect(collected).toHaveLength(3)
    expect(byUrl.get('https://a.example')?.path).toEqual(['Work'])
    expect(byUrl.get('https://b.example')?.path).toEqual(['Work', 'Deep'])
    expect(byUrl.get('https://c.example')?.path).toEqual([])
  })

  it('parses sibling-<dl> nesting style (RC-G robustness)', () => {
    // 另一种导出器把 <dl> 作为 <dt> 的后续兄弟而非直接子;遍历器应同样还原层级。
    const tree: BookmarkTreeNode = {
      tag: 'dl',
      children: [
        { tag: 'dt', children: [{ tag: 'h3', text: 'Work', children: [] }] },
        {
          tag: 'dl', children: [
            { tag: 'dt', children: [{ tag: 'a', text: 'A', href: 'https://a.example', children: [] }] },
          ],
        },
        { tag: 'dt', children: [{ tag: 'a', text: 'C', href: 'https://c.example', children: [] }] },
      ],
    }
    const collected: Array<{ url: string; path: string[] }> = []
    traverseBookmarksTree(tree, (url, _title, folderPath) => collected.push({ url, path: folderPath }))
    const byUrl = new Map(collected.map((it) => [it.url, it]))
    expect(byUrl.get('https://a.example')?.path).toEqual(['Work'])
    expect(byUrl.get('https://c.example')?.path).toEqual([])
  })

  it('parses TMarks/browser JSON variants and reports invalid URLs', () => {
    const result = parseBookmarksJson(JSON.stringify({ bookmarks: [{ title: 'A', url: 'https://a.example', tags: 'one,two' }, { title: 'bad', url: 'file:///tmp/a' }] }))
    expect(result.items[0]?.tags).toEqual(['one', 'two'])
    expect(result.errors).toHaveLength(1)
  })

  it('parses text URL lines with optional titles', () => {
    const result = parseTextUrls('https://a.example A title\nnot-a-url')
    expect(result.items).toHaveLength(1)
    expect(result.items[0]?.title).toBe('A title')
    expect(result.errors).toHaveLength(1)
  })

  it('routes .csv files to the CSV parser', () => {
    const result = parseImportFile('title,url\nExample,https://example.com', 'bookmarks.csv')
    expect(result.items).toHaveLength(1)
    expect(result.items[0]).toMatchObject({ title: 'Example', url: 'https://example.com' })
  })

  it('parses a two-column header CSV in url,title order', () => {
    const result = parseCsvUrls('url,title\nhttps://a.example,First\nhttps://b.example,Second')
    expect(result.items).toHaveLength(2)
    expect(result.items[0]).toMatchObject({ title: 'First', url: 'https://a.example' })
    expect(result.items[1]).toMatchObject({ title: 'Second', url: 'https://b.example' })
  })

  it('parses a two-column CSV without header in title,url order', () => {
    const result = parseCsvUrls('Example Site,https://example.com/path\nOther,https://other.example')
    expect(result.items).toHaveLength(2)
    expect(result.items[0]).toMatchObject({ title: 'Example Site', url: 'https://example.com/path' })
  })

  it('parses a two-column CSV without header in url,title order', () => {
    const result = parseCsvUrls('https://example.com,Example Site')
    expect(result.items).toHaveLength(1)
    expect(result.items[0]).toMatchObject({ title: 'Example Site', url: 'https://example.com' })
  })

  it('parses quoted CSV fields and keeps commas inside URLs', () => {
    const result = parseCsvUrls('"Title, with comma","https://example.com/a,b"\n"Plain","https://plain.example"')
    expect(result.items).toHaveLength(2)
    expect(result.items[0]).toMatchObject({ title: 'Title, with comma', url: 'https://example.com/a,b' })
    expect(result.items[1]).toMatchObject({ title: 'Plain', url: 'https://plain.example' })
  })
})

describe('bookmark import normalization and dedupe', () => {
  it('normalizes defaults and merges duplicate metadata', () => {
    const first = normalizeImportBookmark({ url: 'https://example.com/#one', title: '' }, 0, 'json')!
    const second = normalizeImportBookmark({ url: 'HTTPS://EXAMPLE.COM/', title: 'Example', tags: ['work'] }, 1, 'json')!
    const result = dedupeImportBookmarks([first, second], [], 'merge')
    expect(result.items).toHaveLength(1)
    expect(result.items[0]).toMatchObject({ title: 'Example', tags: ['work'] })
  })

  it('skips URLs already present locally', () => {
    const item = normalizeImportBookmark({ url: 'https://example.com' }, 0, 'text')!
    expect(dedupeImportBookmarks([item], ['HTTPS://EXAMPLE.COM/#hash']).skipped).toBe(1)
  })
})

describe('dedupe scale', () => {
  // Regression: dedupe used a linear scan of the accepted list, re-parsing every
  // previously accepted URL for every incoming item. A browser export of this
  // size froze the page; with a keyed lookup it finishes in well under a second.
  it('handles a large export without quadratic blowup', () => {
    const items = Array.from({ length: 20000 }, (_, i) => ({
      title: `Bookmark ${i}`,
      url: `https://example.com/page-${i % 15000}`,
      description: '',
      folderPath: [] as string[],
      tags: [] as string[],
    }))

    const started = Date.now()
    const result = dedupeImportBookmarks(items)
    expect(result.items).toHaveLength(15000)
    expect(result.skipped).toBe(5000)
    expect(Date.now() - started).toBeLessThan(5000)
  })
})

describe('organize-bookmarks skill format contract', () => {
  // skills/organize-bookmarks/SKILL.md documents the JSON import shape
  // for AI-driven bulk curation. This test pins that contract: if the importer
  // changes shape, or the skill's example drifts from what parses cleanly,
  // CI fails instead of AI-generated files silently breaking.
  const fixture = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), '../../../skills/organize-bookmarks/example-import.json'),
    'utf8',
  )

  it('parses the skill example file with zero errors and full fidelity', () => {
    const result = parseBookmarksJson(fixture)
    expect(result.errors).toEqual([])
    expect(result.items).toHaveLength(3)

    const [tokio, workers, color] = result.items
    expect(tokio).toMatchObject({
      title: 'Tokio 官方文档',
      url: 'https://tokio.rs/tokio/tutorial',
      description: 'Rust 异步运行时的官方教程',
      folderPath: ['开发', 'Rust'],
      tags: ['rust', '异步', '文档'],
    })
    expect(workers).toMatchObject({ folderPath: ['开发', '云平台'], tags: ['cloudflare', 'serverless', '文档'] })
    expect(color).toMatchObject({ folderPath: ['设计', '设计基础'], tags: ['色彩', '构图'] })
  })

  it('enforces the documented hard limits the skill promises', () => {
    // The PARSER keeps up to 8 path segments; the two-level truncation the
    // skill warns about happens at EXECUTION time (ensureBookmarkFolderPath
    // slices to 2) — so a 4-deep path parses and previews, then silently
    // lands as two levels. That is exactly why the skill tells the AI to
    // curate to ≤2 levels itself instead of relying on the importer.
    const deep = parseBookmarksJson(JSON.stringify({
      bookmarks: [{ url: 'https://a.example', title: 'A', folderPath: ['一', '二', '三', '四', '五', '六', '七', '八', '九'] }],
    }))
    expect(deep.items[0]?.folderPath).toEqual(['一', '二', '三', '四', '五', '六', '七', '八'])
    // >32 tags drop; weak names are NOT filtered by the importer — the skill's
    // blacklist is the AI's responsibility, importer only bounds shape.
    const manyTags = parseBookmarksJson(JSON.stringify({
      bookmarks: [{ url: 'https://b.example', title: 'B', tags: Array.from({ length: 40 }, (_, i) => `t${i}`) }],
    }))
    expect(manyTags.items[0]?.tags).toHaveLength(32)
    // non-http URLs rejected (file: scheme)
    const badScheme = parseBookmarksJson(JSON.stringify({
      bookmarks: [{ url: 'file:///tmp/x', title: 'X' }, { url: 'https://ok.example', title: 'OK' }],
    }))
    expect(badScheme.items).toHaveLength(1)
    expect(badScheme.errors).toHaveLength(1)
  })
})
