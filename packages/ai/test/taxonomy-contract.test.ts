import { describe, expect, it } from 'vitest'
import { buildSingleBookmarkPrompt, canonicalizeTagsToExisting, normalizeBookmarkClassificationOutput } from '../src/prompts'
import { TAG_REUSE_LIMITS, buildSystemPrompt } from '../src/prompt-system'

describe('weak-name enforcement matches the prompt contract in both languages', () => {
  // The system prompt forbids these names; the normalizer is the net for when
  // the model ignores it. Both halves must list the same names, or the Chinese
  // UI gets Chinese-weak tags the filter was never taught.
  it('drops Chinese weak tags the model was told not to emit', () => {
    const result = normalizeBookmarkClassificationOutput(
      { tags: ['其他', '未分类', '待整理', '网页', '收藏', '资料', '信息'] },
      { url: 'https://example.com/' }
    )
    expect(result.tags).toEqual([])
  })

  it('still drops the English weak tags', () => {
    const result = normalizeBookmarkClassificationOutput(
      { tags: ['other', 'misc', 'link', 'content'] },
      { url: 'https://example.com/' }
    )
    expect(result.tags).toEqual([])
  })

  it('keeps substantive Chinese tags untouched', () => {
    const result = normalizeBookmarkClassificationOutput(
      { tags: ['开源', 'Cloudflare', '边缘计算'] },
      { url: 'https://example.com/' }
    )
    expect(result.tags).toEqual(['开源', 'Cloudflare', '边缘计算'])
  })

  it('filters Chinese weak folder names out of the classification path', () => {
    const result = normalizeBookmarkClassificationOutput(
      { classification: { primary: '其他', secondary: '未分类', folderPath: ['其他', '未分类'] } },
      { url: 'https://example.com/' }
    )
    expect(result.classification).toBeUndefined()
  })

  it('keeps a real path while dropping only its weak segment', () => {
    const result = normalizeBookmarkClassificationOutput(
      { classification: { primary: '开发', secondary: '资料', folderPath: ['开发', '资料'] } },
      { url: 'https://example.com/' }
    )
    expect(result.classification?.folderPath).toEqual(['开发'])
  })
})

describe('storage-limit parity with the server planes', () => {
  // The server stores tag names at 50 (REST sanitizeString / bookmark-plane
  // normalizeTagNames) and folder names at 120 (sync-plane clampText). The AI
  // normalizer must agree: a 51+ char tag is a sentence and gets dropped, an
  // overlong folder segment is truncated (not dropped) so the bookmark keeps
  // its classification.
  it('drops tags over the 50-char storage cap and keeps the 50-char edge', () => {
    const result = normalizeBookmarkClassificationOutput(
      { tags: ['超'.repeat(51), '长'.repeat(50)] },
      { url: 'https://example.com/' }
    )
    expect(result.tags).toEqual(['长'.repeat(50)])
  })

  it('truncates folder segments to the 120-char storage clamp', () => {
    const result = normalizeBookmarkClassificationOutput(
      { classification: { folderPath: ['开'.repeat(200), '工具'] } },
      { url: 'https://example.com/' }
    )
    expect(result.classification?.folderPath).toEqual(['开'.repeat(120), '工具'])
  })
})

describe('page-content prompt budget', () => {
  it('gives page content a larger budget than titles', () => {
    const content = '字'.repeat(1500)
    const { user } = buildSingleBookmarkPrompt('https://example.com/', {
      sourceBookmarks: [{ url: 'https://example.com/', content }],
    })
    // 1500 chars must survive whole — the old shared 500-char budget cut it.
    expect(user).toContain('字'.repeat(1500))
  })

  it('still bounds runaway content', () => {
    const content = 'x'.repeat(5000)
    const { user } = buildSingleBookmarkPrompt('https://example.com/', {
      sourceBookmarks: [{ url: 'https://example.com/', content }],
    })
    expect(user).toContain('x'.repeat(2000))
    expect(user).not.toContain('x'.repeat(2001))
  })

  it('keeps the smaller budget for title and description', () => {
    const { user } = buildSingleBookmarkPrompt('https://example.com/', {
      sourceBookmarks: [{ url: 'https://example.com/', title: 'T'.repeat(800) }],
    })
    expect(user).toContain('T'.repeat(500))
    expect(user).not.toContain('T'.repeat(501))
  })
})

describe('existing taxonomy visibility', () => {
  it('carries up to the shared tag-library limit', () => {
    const tags = Array.from({ length: 400 }, (_, i) => `tag-${i}`)
    const { user } = buildSingleBookmarkPrompt('https://example.com/', { existingTags: tags })
    expect(user).toContain('tag-299')
    expect(user).not.toContain('tag-300')
  })

  it('shows every existing folder path when the tree is small', () => {
    const folders = Array.from({ length: 5 }, (_, i) => ({ name: `F${i}`, path: [`一级`, `F${i}`] }))
    const { user } = buildSingleBookmarkPrompt('https://example.com/', { existingFolders: folders })
    for (const folder of folders) {
      expect(user).toContain(folder.path.join(' / '))
    }
  })
})

describe('tag reuse pressure scales with library size', () => {
  // 用户决策:标签库越大,现有标签的复用权重越高,否则标签随每次分类无限增殖。
  // 三档压力必须与 prompt-system 的 TAG_REUSE_LIMITS 同口径。

  it('escalates the reuse pressure through the three size tiers', () => {
    const small = buildSingleBookmarkPrompt('https://example.com/', { existingTags: ['linux'], tagLibrarySize: 10 }).user
    expect(small).toContain('标签治理动态统计：标签库已有 10 个标签；优先复用已有标签。')
    expect(small).not.toContain('禁止新建')

    const medium = buildSingleBookmarkPrompt('https://example.com/', { existingTags: ['linux'], tagLibrarySize: 60 }).user
    expect(medium).toContain('优先复用已有标签；新建标签需确证现有候选中没有同义或近义表达')
    expect(medium).not.toContain('默认全部从已有标签中复用')

    const large = buildSingleBookmarkPrompt('https://example.com/', { existingTags: ['linux'], tagLibrarySize: 200 }).user
    expect(large).toContain('规模已大——本次默认全部从已有标签中复用，禁止新建标签')
  })

  it('reports the true library size and declares the candidate ordering semantics', () => {
    const user = buildSingleBookmarkPrompt('https://example.com/', { existingTags: ['a'], tagLibrarySize: 500 }).user
    expect(user).toContain('已有标签库共 500 个')
    expect(user).toContain('按使用频次降序排列')
  })

  it('falls back to the sent candidate count when the true size is unknown', () => {
    const user = buildSingleBookmarkPrompt('https://example.com/', { existingTags: ['a', 'b'] }).user
    expect(user).toContain('已有标签库共 2 个')
  })

  it('pins the size thresholds into the locked system contract', () => {
    const system = buildSystemPrompt()
    expect(system).toContain('bookmark.single.v1@1.2.0')
    expect(system).toContain(`库达到 ${TAG_REUSE_LIMITS.discourageNewAt} 个`)
    expect(system).toContain(`达到 ${TAG_REUSE_LIMITS.forbidNewAt} 个`)
  })
})

describe('post-parse reuse net (canonicalizeTagsToExisting)', () => {
  // 提示词承诺"大小写、单复数、缩写优先复用";模型违诺输出变体时,这是确定性
  // 执法网:变体归并回现有标签的规范拼写,归并产生的重复一并去重。

  it('maps case variants of parsed tags onto the existing canonical spelling', () => {
    expect(canonicalizeTagsToExisting(['LINUX', 'Rust'], [{ name: 'Linux', bookmarkCount: 3 }])).toEqual(['Linux', 'Rust'])
  })

  it('accepts plain-string libraries and drops case-variant duplicates after mapping', () => {
    expect(canonicalizeTagsToExisting(['react', 'React', 'vue'], ['React', 'Vue'])).toEqual(['React', 'Vue'])
  })

  it('keeps genuinely new tags and skips empty entries', () => {
    expect(canonicalizeTagsToExisting(['Cloudflare', '', '  '], [])).toEqual(['Cloudflare'])
  })
})
